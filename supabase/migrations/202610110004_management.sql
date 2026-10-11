-- Additive management stage. Never edit/reapply migrations 001-003.
-- New management mutations MUST acquire private.management_lock() BEFORE
-- locking actor/target users, groups, enrollments, payments or operations.
begin;

create function private.management_lock() returns void
language plpgsql volatile set search_path = pg_catalog,private as $$
begin
  -- An advisory lock cannot refresh a REPEATABLE READ snapshot. Waiting on
  -- it with an old snapshot could miss a committed seat reservation.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'management mutations require READ COMMITTED isolation' using errcode = '25001';
  end if;
  perform pg_advisory_xact_lock(hashtext('uyym:management')::bigint);
end;
$$;

alter table private.groups
  add column ends_at timestamptz,
  add column schedule_description text not null default '' check(char_length(schedule_description) <= 4000),
  add column updated_at timestamptz not null default now(),
  add column revision bigint not null default 1 check(revision > 0),
  add constraint groups_dates_check check(ends_at is null or (starts_at is not null and ends_at > starts_at));
alter table private.courses add column revision bigint not null default 1 check(revision > 0);
alter table private.site_settings add column revision bigint not null default 1 check(revision > 0);
alter table private.teacher_assignments
  add column revision bigint not null default 1 check(revision > 0),
  add column updated_at timestamptz not null default now();

alter table private.enrollments drop constraint enrollments_status_check;
alter table private.enrollments
  add constraint enrollments_status_check check(status in ('pending','active','paused','expired','revoked')),
  add column revision bigint not null default 1 check(revision > 0),
  add column revoked_at timestamptz,
  add column revoked_by uuid references private.app_users(id) on delete restrict,
  add column revocation_reason text check(char_length(revocation_reason) <= 1000);
comment on column private.enrollments.status is 'Stored intent; effective expiry is computed per request. Pending, active and paused rows with expires_at in the future reserve a group seat, including future starts. Revoked access never auto-resumes.';
create index enrollments_reserved_group_idx on private.enrollments(group_id,expires_at) where status in ('pending','active','paused');

create function private.management_touch_revision() returns trigger
language plpgsql set search_path = pg_catalog,private as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end;
$$;
create trigger groups_revision before update on private.groups for each row execute function private.management_touch_revision();
create trigger courses_revision before update on private.courses for each row execute function private.management_touch_revision();
create trigger site_settings_revision before update on private.site_settings for each row execute function private.management_touch_revision();
create trigger teacher_assignments_revision before update on private.teacher_assignments for each row execute function private.management_touch_revision();
create trigger enrollments_revision before update on private.enrollments for each row execute function private.management_touch_revision();

-- BEFORE STATEMENT obtains the global lock before UPDATE starts locking rows.
-- A row-only trigger would allow raw capacity UPDATE to lock a group first
-- while an enrollment writer held the global lock and waited on that group.
create function private.management_before_statement() returns trigger
language plpgsql set search_path = pg_catalog,private as $$
begin
  perform private.management_lock();
  return null;
end;
$$;
create trigger groups_management_statement before insert or update or delete on private.groups
for each statement execute function private.management_before_statement();
create trigger enrollments_management_statement before insert or update or delete on private.enrollments
for each statement execute function private.management_before_statement();

-- A group is a cohort. Pausing retains its seat; release it by revocation or
-- expiry. Count all future reservations, not merely students watching now.
-- The global lock deliberately trades throughput for simple safe management
-- at initial scale. It does NOT limit the number of registered accounts.
create function private.enforce_enrollment_capacity() returns trigger
language plpgsql set search_path = pg_catalog,private as $$
declare v_capacity integer; v_reserved bigint;
begin
  perform private.management_lock();
  if tg_op = 'UPDATE' then
    perform 1 from private.groups where id in (old.group_id,new.group_id) order by id for update;
  else
    perform 1 from private.groups where id = new.group_id for update;
  end if;
  if new.group_id is not null and new.status in ('pending','active','paused') and new.expires_at > clock_timestamp() then
    select capacity into v_capacity from private.groups where id = new.group_id;
    -- Missing group is rejected by the FK; never invent a capacity fallback.
    if v_capacity is not null then
      select count(*) into v_reserved from private.enrollments e
      where e.group_id = new.group_id and e.id <> new.id
        and e.status in ('pending','active','paused') and e.expires_at > clock_timestamp();
      if v_reserved >= v_capacity then
        raise exception 'group capacity exceeded' using errcode = '23514',constraint = 'group_capacity_limit';
      end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger enrollment_capacity before insert or update of group_id,status,starts_at,expires_at on private.enrollments
for each row execute function private.enforce_enrollment_capacity();

create function private.enforce_group_capacity() returns trigger
language plpgsql set search_path = pg_catalog,private as $$
declare v_reserved bigint;
begin
  perform private.management_lock();
  select count(*) into v_reserved from private.enrollments e
  where e.group_id = new.id and e.status in ('pending','active','paused') and e.expires_at > clock_timestamp();
  if new.capacity < v_reserved then
    raise exception 'group capacity below reserved seats' using errcode = '23514',constraint = 'group_capacity_limit';
  end if;
  return new;
end;
$$;
create trigger group_capacity before update of capacity on private.groups
for each row execute function private.enforce_group_capacity();

alter table private.payments add column method text not null default 'manual'
  check(method in ('manual','cash','bank_transfer','card','other'));
create table private.payment_corrections (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references private.payments(id) on delete restrict,
  revision integer not null check(revision > 0),
  amount_kzt integer not null check(amount_kzt > 0),
  paid_at timestamptz not null,
  method text not null default 'manual' check(method in ('manual','cash','bank_transfer','card','other')),
  note text not null default '' check(char_length(note) <= 4000),
  state text not null default 'posted' check(state in ('posted','voided')),
  reason text not null check(char_length(reason) between 1 and 1000),
  recorded_by uuid not null references private.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(payment_id,revision)
);
comment on table private.payment_corrections is 'Append-only full replacement values. Effective payment is newest revision, or original receipt at revision 0; voided revisions contribute zero. Recording/correcting a payment never grants access.';
create function private.payment_history_immutable() returns trigger
language plpgsql set search_path = pg_catalog,private as $$
begin
  raise exception 'payment history is append-only' using errcode = '42501';
end;
$$;
create trigger payments_append_only before update or delete on private.payments
for each row execute function private.payment_history_immutable();
create trigger payment_corrections_append_only before update or delete on private.payment_corrections
for each row execute function private.payment_history_immutable();

-- Auth API and PostgreSQL do not share a transaction. Record SAFE intent and
-- reconcile remote uncertainty. No password, TOTP, token or Auth response is
-- stored here. Reset preflight blocks authentication until confirmed complete.
create table private.auth_operations (
  id uuid primary key,
  actor_id uuid not null references private.app_users(id) on delete restrict,
  action text not null check(action in ('create_user','reset_password')),
  request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
  target_user_id uuid references private.app_users(id) on delete restrict,
  auth_user_id uuid,
  phone text check(phone ~ '^\+[1-9][0-9]{1,14}$'),
  name text check(char_length(name) between 1 and 120),
  requested_role text check(requested_role in ('STUDENT','TEACHER')),
  state text not null default 'prepared' check(state in ('prepared','inflight','auth_confirmed','completed','failed','reconcile_required')),
  attempts integer not null default 0 check(attempts >= 0),
  lease_owner uuid,
  lease_until timestamptz,
  last_error_code text check(last_error_code ~ '^[A-Z0-9_]{1,80}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check((action = 'create_user' and phone is not null and name is not null and requested_role is not null)
     or (action = 'reset_password' and target_user_id is not null)),
  check(state <> 'completed' or completed_at is not null)
);
create index auth_operations_actor_time_idx on private.auth_operations(actor_id,created_at desc);
create index auth_operations_unfinished_idx on private.auth_operations(updated_at) where state in ('prepared','inflight','auth_confirmed','reconcile_required');
create unique index auth_operations_one_create_phone on private.auth_operations(phone)
where action = 'create_user' and state in ('prepared','inflight','auth_confirmed','reconcile_required');
create unique index auth_operations_one_reset_user on private.auth_operations(target_user_id)
where action = 'reset_password' and state in ('prepared','inflight','auth_confirmed','reconcile_required');
alter table private.app_users add column auth_operation_id uuid references private.auth_operations(id) on delete restrict;
comment on column private.app_users.auth_operation_id is 'Non-null blocks all Auth setup and learning API admission. Backend must check it during login, context, proof and session activation. Never clear automatically after a remote timeout.';

-- Idempotent academic mutations cache only scalar safe acknowledgements.
-- Fresh entity DTOs can be read separately; temporary passwords are one-use.
create function private.management_response_is_safe(p_response jsonb) returns boolean
language plpgsql immutable set search_path = pg_catalog,private as $$
declare v_key text; v_value jsonb; v_text text;
begin
  if jsonb_typeof(p_response) <> 'object' then return false; end if;
  for v_key,v_value in select key,value from jsonb_each(p_response) loop
    v_text := v_value #>> '{}';
    if v_key in ('id','user_id','group_id','course_id','enrollment_id','payment_id','assignment_id','operation_id') then
      if jsonb_typeof(v_value) <> 'string' or v_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return false; end if;
    elsif v_key = 'revision' then
      if jsonb_typeof(v_value) <> 'number' or v_text !~ '^[0-9]+$' or v_text::numeric < 0 then return false; end if;
    elsif v_key in ('ok','created','completed') then
      if jsonb_typeof(v_value) <> 'boolean' then return false; end if;
    elsif v_key = 'status' then
      if jsonb_typeof(v_value) <> 'string' or v_text not in ('pending','active','paused','expired','revoked','completed') then return false; end if;
    else return false;
    end if;
  end loop;
  return true;
end;
$$;
create table private.mutation_receipts (
  operation_id uuid primary key,
  actor_id uuid not null references private.app_users(id) on delete restrict,
  action text not null check(action ~ '^[a-z][a-z0-9_.-]{0,80}$'),
  request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
  response jsonb not null default '{}' check(private.management_response_is_safe(response)),
  created_at timestamptz not null default now()
);
create index mutation_receipts_actor_time_idx on private.mutation_receipts(actor_id,created_at desc);
create function private.mutation_receipt_immutable() returns trigger
language plpgsql set search_path = pg_catalog,private as $$
begin
  raise exception 'mutation receipts are immutable' using errcode = '42501';
end;
$$;
create trigger mutation_receipts_append_only before update or delete on private.mutation_receipts
for each row execute function private.mutation_receipt_immutable();

-- Lookup indexes support FK-safe bounded cleanup and private session lists.
create index challenges_session_idx on private.challenges(session_id) where session_id is not null;
create index challenges_ticket_idx on private.challenges(ticket_id) where ticket_id is not null;
create index login_tickets_user_time_idx on private.login_tickets(user_id,created_at desc);
create index app_sessions_user_time_idx on private.app_sessions(user_id,created_at desc);
create index playback_grants_expiry_idx on private.playback_grants(expires_at);

alter table private.payment_corrections enable row level security;
alter table private.payment_corrections force row level security;
alter table private.auth_operations enable row level security;
alter table private.auth_operations force row level security;
alter table private.mutation_receipts enable row level security;
alter table private.mutation_receipts force row level security;
revoke all on all tables in schema private from public,anon,authenticated,service_role;
revoke all on all sequences in schema private from public,anon,authenticated,service_role;
revoke all on all functions in schema private from public,anon,authenticated,service_role;
-- Existing dedicated runtime role needs new objects as well. Fresh installs
-- run backend-role.sql after migrations; immutable triggers remain enforced.
do $$
begin
  if exists(select 1 from pg_roles where rolname = 'uyym_backend') then
    grant select,insert on private.payment_corrections,private.mutation_receipts to uyym_backend;
    grant select,insert,update on private.auth_operations to uyym_backend;
    -- Stage-1 default table privileges also grant DELETE. Remove that
    -- inherited privilege explicitly so uncertain Auth history is retained.
    revoke delete on private.auth_operations from uyym_backend;
  grant execute on all functions in schema private to uyym_backend;
    revoke update,delete on private.payments,private.payment_corrections,private.mutation_receipts from uyym_backend;
  end if;
end;
$$;
commit;
