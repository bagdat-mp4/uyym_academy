-- UYYM Academy / stage 1. Apply to a NEW Supabase project.
-- Every educational table lives outside the Data API's public schema.
-- Only the trusted backend's DATABASE_URL connection may use this schema.
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
revoke all on schema private from service_role;

create table private.app_users (
  id uuid primary key references auth.users(id) on delete restrict,
  phone text not null unique check (phone ~ '^\+[1-9][0-9]{1,14}$'),
  name text not null check (char_length(name) between 1 and 120),
  role text not null check (role in ('ADMIN', 'TEACHER', 'STUDENT')),
  active boolean not null default true,
  must_change_password boolean not null default true,
  auth_epoch bigint not null default 1 check (auth_epoch > 0),
  admin_totp_secret_encrypted text,
  admin_totp_last_counter bigint,
  recovery_hashes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (role = 'ADMIN' or (admin_totp_secret_encrypted is null and cardinality(recovery_hashes) = 0))
);
comment on column private.app_users.admin_totp_secret_encrypted is 'Authenticated encryption performed by backend. Encryption key must never be stored in PostgreSQL.';
comment on column private.app_users.recovery_hashes is 'Hashes of random one-use administrator recovery codes; no plaintext recovery code storage.';

create table private.site_settings (
  id boolean primary key default true check (id),
  title text not null default 'UYYM Academy',
  contacts jsonb not null default '{}' check (jsonb_typeof(contacts) = 'object'),
  teachers_public jsonb not null default '[]' check (jsonb_typeof(teachers_public) = 'array'),
  faq jsonb not null default '[]' check (jsonb_typeof(faq) = 'array'),
  updated_at timestamptz not null default now(),
  updated_by uuid references private.app_users(id) on delete restrict
);
insert into private.site_settings(id) values (true);

create table private.courses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null,
  description text not null default '',
  published boolean not null default false,
  active boolean not null default true,
  weeks integer not null default 6 check (weeks > 0),
  lessons_per_week integer not null default 2 check (lessons_per_week > 0),
  lesson_minutes integer not null default 90 check (lesson_minutes > 0),
  price_kzt integer not null default 60000 check (price_kzt >= 0),
  default_group_size integer not null default 5 check (default_group_size > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into private.courses(slug,title,description,published) values
  ('calculus-i','Calculus I','Quiz, Midterm, Endterm және Final емтихандарына дайындық.',true),
  ('linear-algebra','Linear Algebra','Quiz, Midterm, Endterm және Final емтихандарына дайындық.',true),
  ('pp1','PP1 / Principles of Programming I','C++ тіліндегі бағдарламалау негіздері.',true);

create table private.groups (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references private.courses(id) on delete restrict,
  title text not null,
  active boolean not null default true,
  starts_at timestamptz,
  capacity integer not null default 5 check (capacity > 0),
  created_at timestamptz not null default now(),
  unique(id, course_id)
);
create index groups_course_idx on private.groups(course_id);

create table private.teacher_assignments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references private.app_users(id) on delete restrict,
  course_id uuid not null references private.courses(id) on delete restrict,
  group_id uuid,
  can_manage_access boolean not null default false,
  created_by uuid not null references private.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (group_id,course_id) references private.groups(id,course_id) on delete restrict,
  check (group_id is not null or can_manage_access = false)
);
create unique index teacher_group_unique on private.teacher_assignments(teacher_id,group_id) where group_id is not null;
create unique index teacher_course_unique on private.teacher_assignments(teacher_id,course_id) where group_id is null;
create index teacher_assignments_course_idx on private.teacher_assignments(course_id);
comment on table private.teacher_assignments is 'A null group_id permits course content editing only, never a global student list or enrollment editing.';

create table private.enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references private.app_users(id) on delete restrict,
  course_id uuid not null references private.courses(id) on delete restrict,
  group_id uuid,
  status text not null default 'pending' check (status in ('pending','active','paused','expired')),
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','partial','paid','refunded')),
  created_by uuid not null references private.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,course_id),
  foreign key(group_id,course_id) references private.groups(id,course_id) on delete restrict,
  check (expires_at > starts_at)
);
create index enrollments_course_group_idx on private.enrollments(course_id,group_id);
create index enrollments_expiry_idx on private.enrollments(expires_at) where status = 'active';
comment on column private.enrollments.payment_status is 'Payment recording does not activate or extend access. Access is derived from status and the UTC interval.';

create table private.payments (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references private.enrollments(id) on delete restrict,
  amount_kzt integer not null check(amount_kzt > 0),
  paid_at timestamptz not null,
  recorded_by uuid not null references private.app_users(id) on delete restrict,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index payments_enrollment_idx on private.payments(enrollment_id);

-- A binding remains reserved after logout, password reset, and session expiry.
-- The actual private CryptoKey never leaves IndexedDB and never reaches this DB.
create table private.device_bindings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references private.app_users(id) on delete restrict,
  public_key jsonb not null,
  status text not null default 'pending' check (status in ('pending','approved','revoked','rejected')),
  label text not null check(char_length(label) between 1 and 120),
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  revoked_at timestamptz,
  approved_by uuid references private.app_users(id) on delete restrict,
  unique(id,user_id),
  check (jsonb_typeof(public_key) = 'object' and public_key->>'kty' = 'EC' and public_key->>'crv' = 'P-256' and public_key ? 'x' and public_key ? 'y' and not (public_key ? 'd')),
  check (status <> 'approved' or (approved_at is not null and approved_by is not null and revoked_at is null))
);
create unique index one_approved_device_per_user on private.device_bindings(user_id) where status = 'approved';
create index device_pending_idx on private.device_bindings(requested_at) where status = 'pending';
create index device_bindings_user_idx on private.device_bindings(user_id);

-- Short-lived password-authenticated setup context; never a learning session.
create table private.login_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references private.app_users(id) on delete restrict,
  device_id uuid not null,
  token_hash text not null unique check(char_length(token_hash) >= 32),
  csrf_token text not null check(char_length(csrf_token) >= 32),
  auth_epoch bigint not null check(auth_epoch > 0),
  mfa_verified boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  foreign key(device_id,user_id) references private.device_bindings(id,user_id) on delete restrict,
  unique(id,user_id,device_id),
  check(expires_at > created_at)
);
create index login_tickets_expiry_idx on private.login_tickets(expires_at);

create table private.app_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references private.app_users(id) on delete restrict,
  device_id uuid not null,
  token_hash text not null unique check (char_length(token_hash) >= 32),
  csrf_token text not null check(char_length(csrf_token) >= 32),
  mfa_verified boolean not null default false,
  auth_epoch bigint not null check (auth_epoch > 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  foreign key(device_id,user_id) references private.device_bindings(id,user_id) on delete restrict,
  unique(id,user_id,device_id),
  check(expires_at > created_at)
);
-- Expired rows must first be marked revoked in the session-opening transaction.
-- Stronger invariant also applies to teachers/admins in this POC.
create unique index one_unrevoked_session_per_user on private.app_sessions(user_id) where revoked_at is null;
create index app_sessions_expiry_idx on private.app_sessions(expires_at) where revoked_at is null;

create table private.challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references private.app_users(id) on delete restrict,
  session_id uuid,
  ticket_id uuid,
  device_id uuid not null,
  purpose text not null check(char_length(purpose) between 1 and 80),
  method text not null check (method in ('GET','POST','PUT','PATCH','DELETE','HEAD')),
  path text not null check (left(path,1) = '/' and char_length(path) <= 2048),
  nonce text not null unique check (char_length(nonce) >= 32),
  body_hash text not null default 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' check(body_hash ~ '^[0-9a-f]{64}$'),
  auth_epoch bigint not null check (auth_epoch > 0),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  foreign key(device_id,user_id) references private.device_bindings(id,user_id) on delete restrict,
  foreign key(session_id,user_id,device_id) references private.app_sessions(id,user_id,device_id) on delete restrict,
  foreign key(ticket_id,user_id,device_id) references private.login_tickets(id,user_id,device_id) on delete restrict,
  check(not (session_id is not null and ticket_id is not null)),
  check (expires_at > issued_at and expires_at <= issued_at + interval '2 minutes')
);
create index challenges_expiry_idx on private.challenges(expires_at);
create index challenges_user_idx on private.challenges(user_id,issued_at desc);

-- Persistent limiter keys hash phone/IP + purpose; no plaintext phone/IP log.
create table private.security_rate_limits (
  key_hash text primary key check(key_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null default now(),
  attempts integer not null default 0 check(attempts >= 0)
);
create index security_rate_limits_window_idx on private.security_rate_limits(window_start);

create table private.drive_folders (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references private.courses(id) on delete restrict,
  folder_id text not null unique,
  label text not null,
  active boolean not null default true,
  created_by uuid not null references private.app_users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table private.lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references private.courses(id) on delete restrict,
  group_id uuid,
  title text not null,
  description text not null default '',
  teacher_id uuid references private.app_users(id) on delete restrict,
  scheduled_at timestamptz,
  live_url text,
  week integer check(week > 0),
  position integer not null default 0 check(position >= 0),
  timestamps jsonb not null default '[]' check(jsonb_typeof(timestamps) = 'array'),
  published boolean not null default false,
  drive_file_id text,
  drive_folder_id text,
  video_mime text,
  video_codec text,
  video_size bigint check(video_size > 0),
  video_duration_seconds numeric check(video_duration_seconds > 0),
  drive_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(group_id,course_id) references private.groups(id,course_id) on delete restrict,
  check (drive_file_id is null or (drive_folder_id is not null and video_mime = 'video/mp4' and video_size is not null))
);
create index lessons_course_idx on private.lessons(course_id,group_id,position);

-- Local ffmpeg packaging uploads short fMP4 fragments to private Drive.
-- Original multi-hour MP4 is NEVER returned as one long-lived response.
create table private.lesson_video_parts (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references private.lessons(id) on delete restrict,
  part_index integer not null check(part_index >= -1),
  drive_file_id text not null,
  drive_folder_id text not null,
  size_bytes integer not null check(size_bytes between 1 and 1048576),
  start_seconds numeric not null check(start_seconds >= 0),
  duration_seconds numeric not null check(duration_seconds >= 0),
  created_at timestamptz not null default now(),
  unique(lesson_id,part_index),
  check((part_index = -1 and duration_seconds = 0) or (part_index >= 0 and duration_seconds > 0))
);

create table private.playback_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references private.app_users(id) on delete restrict,
  session_id uuid not null,
  device_id uuid not null,
  lesson_id uuid not null references private.lessons(id) on delete restrict,
  auth_epoch bigint not null check(auth_epoch > 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  heartbeat_at timestamptz not null default now(),
  revoked_at timestamptz,
  foreign key(session_id,user_id,device_id) references private.app_sessions(id,user_id,device_id) on delete restrict,
  check(expires_at > created_at)
);
create index playback_grants_user_idx on private.playback_grants(user_id) where revoked_at is null;
create index playback_grants_session_idx on private.playback_grants(session_id) where revoked_at is null;

-- Complete LMS data model. Stage-1 POC does not yet expose these workflows.
create table private.materials (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references private.courses(id) on delete restrict,
  group_id uuid,
  lesson_id uuid references private.lessons(id) on delete restrict,
  title text not null,
  section text not null check(section in ('notes','homework','archive','Quiz','Midterm','Endterm','Final')),
  topic text not null default '',
  exam_year integer check(exam_year between 2000 and 2100),
  semester text,
  language text not null default 'kk' check(language in ('kk','ru','en')),
  is_solution boolean not null default false,
  solution_opens_at timestamptz,
  storage_path text not null unique,
  mime text not null check(mime in ('application/pdf','image/png','image/jpeg','image/webp','text/plain','text/x-c++src')),
  file_size bigint not null check(file_size > 0),
  published boolean not null default false,
  created_by uuid not null references private.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key(group_id,course_id) references private.groups(id,course_id) on delete restrict
);
create index materials_filter_idx on private.materials(course_id,section,exam_year,language);

create table private.assignments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references private.courses(id) on delete restrict,
  group_id uuid not null,
  lesson_id uuid references private.lessons(id) on delete restrict,
  title text not null,
  instructions text not null,
  due_at timestamptz not null,
  max_grade numeric(8,2) not null default 100 check(max_grade > 0),
  published boolean not null default false,
  created_by uuid not null references private.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key(group_id,course_id) references private.groups(id,course_id) on delete restrict
);
create index assignments_group_idx on private.assignments(group_id,due_at);

create table private.assignment_materials (
  assignment_id uuid not null references private.assignments(id) on delete restrict,
  material_id uuid not null references private.materials(id) on delete restrict,
  primary key(assignment_id,material_id)
);

create table private.submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references private.assignments(id) on delete restrict,
  user_id uuid not null references private.app_users(id) on delete restrict,
  status text not null default 'submitted' check(status in ('submitted','reviewed','needs_revision')),
  current_version integer not null default 1 check(current_version > 0),
  grade numeric(8,2) check(grade >= 0),
  feedback text not null default '',
  reviewed_by uuid references private.app_users(id) on delete restrict,
  reviewed_at timestamptz,
  late_allowed_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(assignment_id,user_id)
);
create index submissions_user_idx on private.submissions(user_id);
create index submissions_assignment_idx on private.submissions(assignment_id,status);

create table private.submission_versions (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references private.submissions(id) on delete restrict,
  version integer not null check(version > 0),
  answer text not null default '' check(octet_length(answer) <= 100000),
  is_late boolean not null,
  submitted_at timestamptz not null default now(),
  unique(submission_id,version)
);
create table private.submission_files (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references private.submission_versions(id) on delete restrict,
  slot smallint not null check(slot in (1,2)),
  storage_path text not null unique,
  original_name text not null,
  mime text not null check(mime in ('application/pdf','image/png','image/jpeg','image/webp','text/plain','text/x-c++src')),
  file_size integer not null check(file_size between 1 and 5242880),
  sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  unique(version_id,slot)
);

create table private.lesson_progress (
  user_id uuid not null references private.app_users(id) on delete restrict,
  lesson_id uuid not null references private.lessons(id) on delete restrict,
  position_seconds numeric not null default 0 check(position_seconds >= 0),
  completed_at timestamptz,
  last_opened_at timestamptz not null default now(),
  primary key(user_id,lesson_id)
);
comment on column private.lesson_progress.completed_at is 'Set only by explicit student completion; opening the page does not complete a lesson.';

create table private.attendance (
  lesson_id uuid not null references private.lessons(id) on delete restrict,
  user_id uuid not null references private.app_users(id) on delete restrict,
  status text not null check(status in ('present','absent','excused')),
  recorded_by uuid not null references private.app_users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  primary key(lesson_id,user_id)
);

create table private.announcements (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references private.courses(id) on delete restrict,
  group_id uuid,
  title text not null,
  body text not null,
  published boolean not null default false,
  created_by uuid not null references private.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key(group_id,course_id) references private.groups(id,course_id) on delete restrict
);
create index announcements_course_idx on private.announcements(course_id,group_id,created_at desc);

create table private.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references private.app_users(id) on delete restrict,
  subject_id uuid references private.app_users(id) on delete restrict,
  action text not null,
  target_type text not null,
  target_id text,
  metadata jsonb not null default '{}' check(jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  check(not (metadata ?| array['password','temporary_password','token','access_token','refresh_token','cookie','authorization','totp_secret','google_credentials','private_key']))
);
create index audit_log_time_idx on private.audit_log(created_at desc);
create index audit_log_subject_idx on private.audit_log(subject_id,created_at desc);

create function private.audit_immutable() returns trigger
language plpgsql set search_path = pg_catalog,private as $$
begin
  raise exception 'audit_log is append-only' using errcode = '42501';
end;
$$;
create trigger audit_log_append_only before update or delete on private.audit_log
for each row execute function private.audit_immutable();

-- RLS has no browser policies: direct anon/authenticated JWTs have NO access.
-- FORCE also restricts an accidentally granted ordinary table-owner role.
do $$
declare v_table record;
begin
  for v_table in select tablename from pg_catalog.pg_tables where schemaname = 'private'
  loop
    execute format('alter table private.%I enable row level security',v_table.tablename);
    execute format('alter table private.%I force row level security',v_table.tablename);
  end loop;
end;
$$;
revoke all on all tables in schema private from public,anon,authenticated,service_role;
revoke all on all sequences in schema private from public,anon,authenticated,service_role;
revoke all on all functions in schema private from public,anon,authenticated,service_role;
alter default privileges in schema private revoke all on tables from public,anon,authenticated,service_role;
alter default privileges in schema private revoke all on sequences from public,anon,authenticated,service_role;
alter default privileges in schema private revoke execute on functions from public,anon,authenticated,service_role;

commit;
