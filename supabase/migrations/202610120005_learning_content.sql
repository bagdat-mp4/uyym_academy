-- Minimal learning-content workflow: editable lessons, view-only homework and
-- private preparation archive. Applied additively; payment history is kept.

alter table private.lessons
  add column revision bigint not null default 1 check(revision > 0),
  add column created_by uuid references private.app_users(id) on delete restrict;
create trigger lessons_revision before update on private.lessons
for each row execute function private.management_touch_revision();

alter table private.assignments
  alter column due_at drop not null,
  add column revision bigint not null default 1 check(revision > 0),
  add column updated_at timestamptz not null default now();
create trigger assignments_revision before update on private.assignments
for each row execute function private.management_touch_revision();

create table private.archive_entries (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references private.courses(id) on delete restrict,
  group_id uuid,
  category text not null check(category in ('Quiz','Midterm','Endterm','Final')),
  exam_year integer not null check(exam_year between 2000 and 2100),
  semester text not null default '' check(octet_length(semester) <= 80),
  topic text not null default '' check(octet_length(topic) <= 300),
  title text not null check(octet_length(title) between 1 and 300),
  published boolean not null default false,
  revision bigint not null default 1 check(revision > 0),
  created_by uuid not null references private.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(group_id,course_id) references private.groups(id,course_id) on delete restrict
);
create index archive_entries_filter_idx on private.archive_entries(course_id,category,exam_year desc,group_id);
create trigger archive_entries_revision before update on private.archive_entries
for each row execute function private.management_touch_revision();

create table private.learning_files (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references private.courses(id) on delete restrict,
  group_id uuid,
  assignment_id uuid references private.assignments(id) on delete restrict,
  archive_entry_id uuid references private.archive_entries(id) on delete restrict,
  storage_path text not null unique check(storage_path ~ '^learning/[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  original_name text not null check(octet_length(original_name) between 1 and 300),
  mime text not null check(mime in ('application/pdf','image/png','image/jpeg','image/webp','text/plain','text/x-c++src')),
  file_size integer not null check(file_size between 1 and 5242880),
  sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references private.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key(group_id,course_id) references private.groups(id,course_id) on delete restrict,
  check((assignment_id is not null)::integer + (archive_entry_id is not null)::integer = 1)
);
create index learning_files_assignment_idx on private.learning_files(assignment_id);
create index learning_files_archive_idx on private.learning_files(archive_entry_id);

create function private.validate_learning_file_parent() returns trigger
language plpgsql
set search_path = ''
as $$
declare parent_course uuid; parent_group uuid;
begin
  if new.assignment_id is not null then
    select course_id,group_id into parent_course,parent_group from private.assignments where id=new.assignment_id;
  else
    select course_id,group_id into parent_course,parent_group from private.archive_entries where id=new.archive_entry_id;
  end if;
  if parent_course is null or parent_course is distinct from new.course_id or parent_group is distinct from new.group_id then
    raise exception using errcode='23514', message='LEARNING_FILE_SCOPE_MISMATCH';
  end if;
  return new;
end $$;
create trigger learning_files_parent_scope before insert or update on private.learning_files
for each row execute function private.validate_learning_file_parent();

alter table private.archive_entries enable row level security;
alter table private.archive_entries force row level security;
alter table private.learning_files enable row level security;
alter table private.learning_files force row level security;

revoke all on private.archive_entries,private.learning_files from public,anon,authenticated,service_role;
revoke all on all functions in schema private from public,anon,authenticated,service_role;

do $$ begin
  if exists(select 1 from pg_roles where rolname='uyym_backend') then
    grant select,insert,update,delete on private.archive_entries,private.learning_files to uyym_backend;
    grant execute on all functions in schema private to uyym_backend;
  end if;
end $$;
