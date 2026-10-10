-- These functions are callable only through a privileged DATABASE_URL.
-- They are INVOKER functions: there is no browser-callable definer escape hatch.
begin;

create function private.approve_device(p_actor uuid,p_request uuid)
returns table(device_id uuid,auth_epoch bigint)
language plpgsql set search_path = pg_catalog,private as $$
declare
  v_user uuid;
  v_epoch bigint;
  v_replaced boolean;
begin
  if not exists(select 1 from private.app_users where id = p_actor and role = 'ADMIN' and active) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  select d.user_id into v_user from private.device_bindings d where d.id = p_request;
  if v_user is null then raise exception 'request not found' using errcode = 'P0002'; end if;
  -- All device/session mutations lock the same user row before any binding row.
  perform 1 from private.app_users u where u.id = v_user and u.active for update;
  if not found then raise exception 'account unavailable' using errcode = '42501'; end if;
  perform 1 from private.device_bindings d where d.id = p_request and d.status = 'pending' for update;
  if not found then raise exception 'request no longer pending' using errcode = '40001'; end if;
  select exists(select 1 from private.device_bindings d where d.user_id = v_user and d.status = 'approved') into v_replaced;
  update private.device_bindings d set status = 'revoked',revoked_at = now() where d.user_id = v_user and d.status = 'approved';
  update private.app_sessions s set revoked_at = now() where s.user_id = v_user and s.revoked_at is null;
  update private.login_tickets t set revoked_at = now() where t.user_id = v_user and t.revoked_at is null;
  update private.playback_grants g set revoked_at = now() where g.user_id = v_user and g.revoked_at is null;
  update private.challenges c set consumed_at = coalesce(c.consumed_at,now()) where c.user_id = v_user;
  update private.app_users u set auth_epoch = u.auth_epoch + 1,updated_at = now() where u.id = v_user returning u.auth_epoch into v_epoch;
  update private.device_bindings d set status = 'approved',approved_at = now(),approved_by = p_actor,revoked_at = null where d.id = p_request;
  insert into private.audit_log(actor_id,subject_id,action,target_type,target_id,metadata)
  values(p_actor,v_user,case when v_replaced then 'device.replaced' else 'device.approved' end,'device',p_request::text,jsonb_build_object('auth_epoch',v_epoch));
  return query select p_request,v_epoch;
end;
$$;

create function private.revoke_device(p_actor uuid,p_user uuid)
returns bigint language plpgsql set search_path = pg_catalog,private as $$
declare v_epoch bigint;
begin
  if not exists(select 1 from private.app_users where id = p_actor and role = 'ADMIN' and active) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  perform 1 from private.app_users where id = p_user for update;
  if not found then raise exception 'account unavailable' using errcode = 'P0002'; end if;
  update private.device_bindings set status = 'revoked',revoked_at = now() where user_id = p_user and status = 'approved';
  update private.app_sessions set revoked_at = now() where user_id = p_user and revoked_at is null;
  update private.login_tickets set revoked_at = now() where user_id = p_user and revoked_at is null;
  update private.playback_grants set revoked_at = now() where user_id = p_user and revoked_at is null;
  update private.challenges set consumed_at = coalesce(consumed_at,now()) where user_id = p_user;
  update private.app_users set auth_epoch = auth_epoch + 1,updated_at = now() where id = p_user returning auth_epoch into v_epoch;
  insert into private.audit_log(actor_id,subject_id,action,target_type,target_id,metadata)
  values(p_actor,p_user,'device.revoked','user',p_user::text,jsonb_build_object('auth_epoch',v_epoch));
  return v_epoch;
end;
$$;

-- A password-only login cannot create an application session. Backend must
-- verify the P-256 signature and atomically consume its login challenge first.
-- An existing live session is never displaced by a second login attempt.
create function private.open_application_session(p_user uuid,p_device uuid,p_expected_epoch bigint,p_token_hash text,p_csrf_token text,p_mfa_verified boolean default false,p_ttl_seconds integer default 1800)
returns uuid language plpgsql set search_path = pg_catalog,private as $$
declare v_user private.app_users%rowtype; v_id uuid;
begin
  if p_ttl_seconds < 60 or p_ttl_seconds > 86400 then raise exception 'invalid session lifetime'; end if;
  select * into v_user from private.app_users where id = p_user for update;
  if not found or not v_user.active or v_user.must_change_password or v_user.auth_epoch <> p_expected_epoch then
    raise exception 'account unavailable' using errcode = '42501';
  end if;
  if v_user.role = 'ADMIN' and (not p_mfa_verified or v_user.admin_totp_secret_encrypted is null) then
    raise exception 'administrator MFA required' using errcode = '42501';
  end if;
  if not exists(select 1 from private.device_bindings where id = p_device and user_id = p_user and status = 'approved') then
    raise exception 'browser not approved' using errcode = '42501';
  end if;
  -- Expiry and epoch are evaluated at request time, independently of cookie/JWT.
  update private.app_sessions set revoked_at = now() where user_id = p_user and revoked_at is null and (expires_at <= now() or auth_epoch <> v_user.auth_epoch);
  if exists(select 1 from private.app_sessions where user_id = p_user and revoked_at is null) then
    raise exception 'live session already exists' using errcode = '23505';
  end if;
  insert into private.app_sessions(user_id,device_id,token_hash,csrf_token,mfa_verified,auth_epoch,expires_at)
  values(p_user,p_device,p_token_hash,p_csrf_token,p_mfa_verified,v_user.auth_epoch,now() + make_interval(secs => p_ttl_seconds)) returning id into v_id;
  return v_id;
end;
$$;

-- Call AFTER cryptographic verification with the exact signed context.
-- Concurrent consumers cannot both succeed. Proof reuse always returns false.
create function private.consume_challenge(p_id uuid,p_user uuid,p_device uuid,p_session uuid,p_ticket uuid,p_purpose text,p_method text,p_path text,p_nonce text,p_epoch bigint,p_body_hash text)
returns boolean language plpgsql set search_path = pg_catalog,private as $$
declare v_changed integer;
begin
  update private.challenges c set consumed_at = now()
  where c.id = p_id and c.user_id = p_user and c.device_id = p_device
    and c.session_id is not distinct from p_session
    and c.ticket_id is not distinct from p_ticket
    and c.purpose = p_purpose and c.method = p_method and c.path = p_path
    and c.nonce = p_nonce and c.auth_epoch = p_epoch and c.body_hash = p_body_hash
    and c.consumed_at is null and c.expires_at > now()
    and exists(select 1 from private.app_users u where u.id = c.user_id and u.active and u.auth_epoch = c.auth_epoch)
    and exists(select 1 from private.device_bindings d where d.id = c.device_id and d.user_id = c.user_id and d.status in ('pending','approved'))
    and (c.session_id is null or exists(select 1 from private.app_sessions s where s.id = c.session_id and s.user_id = c.user_id and s.device_id = c.device_id and s.auth_epoch = c.auth_epoch and s.revoked_at is null and s.expires_at > now()))
    and (c.ticket_id is null or exists(select 1 from private.login_tickets t where t.id = c.ticket_id and t.user_id = c.user_id and t.device_id = c.device_id and t.auth_epoch = c.auth_epoch and t.revoked_at is null and t.expires_at > now()));
  get diagnostics v_changed = row_count;
  return v_changed = 1;
end;
$$;

revoke all on all functions in schema private from public,anon,authenticated,service_role;
commit;
