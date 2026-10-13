-- Public course applications and idempotent owner approval.
-- This migration is additive and preserves all existing accounts/enrollments.
-- Run once through Supabase migration history. A second run fails atomically;
-- IF NOT EXISTS would conceal a conflicting pre-existing table definition.
begin;

create table private.registration_applications (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  course_id uuid not null references private.courses(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','processing','approved','rejected')),
  operation_id uuid unique references private.auth_operations(id) on delete restrict,
  student_id uuid references private.app_users(id) on delete restrict,
  enrollment_id uuid references private.enrollments(id) on delete restrict,
  approved_by uuid references private.app_users(id) on delete restrict,
  approved_at timestamptz,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'approved') = (student_id is not null and enrollment_id is not null and approved_by is not null and approved_at is not null)),
  check (status <> 'processing' or operation_id is not null)
);

-- A rejected application may be resubmitted; an approved enrollment must not
-- produce a second pending application that the owner can never approve.
create unique index registration_applications_once_phone_course
on private.registration_applications(phone,course_id)
where status in ('pending','processing','approved');
create index registration_applications_status_created_idx
on private.registration_applications(status,created_at desc);
create index registration_applications_course_created_idx
on private.registration_applications(course_id,created_at desc);
create index registration_applications_student_idx
on private.registration_applications(student_id)
where student_id is not null;

create trigger registration_applications_revision
before update on private.registration_applications
for each row execute function private.management_touch_revision();

alter table private.registration_applications enable row level security;
alter table private.registration_applications force row level security;
revoke all on private.registration_applications from public,anon,authenticated,service_role;

do $$
begin
  if exists(select 1 from pg_roles where rolname='uyym_backend') then
    grant select,insert,update on private.registration_applications to uyym_backend;
    -- Default privileges from an earlier backend-role installation may have
    -- granted DELETE automatically. Applications are audit history.
    revoke delete on private.registration_applications from uyym_backend;
  end if;
end;
$$;

commit;
