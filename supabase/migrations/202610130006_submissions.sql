-- Homework submission and review workflow. A version is immutable after it is
-- created; only the submission summary moves between workflow states.

alter table private.submissions
  drop constraint submissions_status_check,
  drop constraint submissions_current_version_check,
  add column revision bigint not null default 1 check(revision > 0),
  add constraint submissions_status_check
    check(status in ('not_submitted','submitted','reviewed','needs_revision')),
  add constraint submissions_current_version_check check(current_version >= 0),
  add constraint submissions_review_consistency check(
    (status = 'not_submitted' and current_version = 0 and grade is null)
    or (status <> 'not_submitted' and current_version > 0)
  );

create trigger submissions_revision before update on private.submissions
for each row execute function private.management_touch_revision();

create function private.validate_submission_grade() returns trigger
language plpgsql
set search_path = ''
as $$
declare allowed_grade numeric;
begin
  if new.grade is null then return new; end if;
  select max_grade into allowed_grade from private.assignments where id=new.assignment_id;
  if allowed_grade is null or new.grade > allowed_grade then
    raise exception using errcode='23514', message='GRADE_OUT_OF_RANGE';
  end if;
  return new;
end $$;

create trigger submissions_grade_limit before insert or update of assignment_id,grade on private.submissions
for each row execute function private.validate_submission_grade();

create function private.validate_assignment_max_grade() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists(select 1 from private.submissions where assignment_id=new.id and grade>new.max_grade) then
    raise exception using errcode='23514', message='GRADE_OUT_OF_RANGE';
  end if;
  return new;
end $$;

create trigger assignments_existing_grade_limit before update of max_grade on private.assignments
for each row execute function private.validate_assignment_max_grade();

alter table private.submission_files
  add constraint submission_files_scoped_path
  check(storage_path ~ '^submissions/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}$');

create function private.validate_submission_file_parent() returns trigger
language plpgsql
set search_path = ''
as $$
declare parent_submission uuid; parent_user uuid;
begin
  select s.id,s.user_id into parent_submission,parent_user
  from private.submission_versions v
  join private.submissions s on s.id=v.submission_id
  where v.id=new.version_id;
  if parent_submission is null or new.storage_path is distinct from
    ('submissions/'||parent_user::text||'/'||parent_submission::text||'/'||new.version_id::text||'/'||new.id::text) then
    raise exception using errcode='23514', message='SUBMISSION_FILE_SCOPE_MISMATCH';
  end if;
  return new;
end $$;

create trigger submission_files_parent_scope before insert or update on private.submission_files
for each row execute function private.validate_submission_file_parent();

-- Submission mutations use the same append-only idempotency receipts as the
-- management API. Extend the deliberately narrow acknowledgement allowlist
-- with the homework workflow states while keeping arbitrary response data out.
create or replace function private.management_response_is_safe(p_response jsonb) returns boolean
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
      if jsonb_typeof(v_value) <> 'string' or v_text not in (
        'pending','active','paused','expired','revoked','completed',
        'not_submitted','submitted','reviewed','needs_revision'
      ) then return false; end if;
    else return false;
    end if;
  end loop;
  return true;
end;
$$;

revoke all on all functions in schema private from public,anon,authenticated,service_role;

do $$ begin
  if exists(select 1 from pg_roles where rolname='uyym_backend') then
    grant execute on all functions in schema private to uyym_backend;
  end if;
end $$;
