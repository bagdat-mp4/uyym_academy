-- Announcements, attendance and explicit lesson progress. The base schema
-- already reserved these tables; this migration adds optimistic revisions
-- and timestamps needed by the working staff/student interfaces.

alter table private.announcements
  add column revision bigint not null default 1 check(revision > 0),
  add column updated_at timestamptz not null default now();
create trigger announcements_revision before update on private.announcements
for each row execute function private.management_touch_revision();

alter table private.attendance
  add column revision bigint not null default 1 check(revision > 0),
  add column updated_at timestamptz not null default now();
create trigger attendance_revision before update on private.attendance
for each row execute function private.management_touch_revision();

alter table private.lesson_progress
  add column updated_at timestamptz not null default now(),
  add constraint lesson_progress_position_limit check(position_seconds <= 86400);

create function private.touch_lesson_progress() returns trigger
language plpgsql
set search_path = pg_catalog,private
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger lesson_progress_updated before update on private.lesson_progress
for each row execute function private.touch_lesson_progress();

revoke all on all functions in schema private from public,anon,authenticated,service_role;

do $$ begin
  if exists(select 1 from pg_roles where rolname='uyym_backend') then
    grant select,insert,update,delete on private.announcements,private.attendance,private.lesson_progress to uyym_backend;
    grant execute on all functions in schema private to uyym_backend;
  end if;
end $$;
