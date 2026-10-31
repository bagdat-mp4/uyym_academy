-- Owner-owned Drive uploads. Apply after 008, before enabling the feature.
begin;

create table private.owner_drive_connection (
  id boolean primary key default true check (id),
  owner_user_id uuid not null references private.app_users(id) on delete restrict,
  google_email text not null,
  refresh_token_encrypted text not null,
  root_folder_id text not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.owner_drive_oauth_requests (
  state_hash text primary key check (state_hash ~ '^[0-9a-f]{64}$'),
  admin_id uuid not null references private.app_users(id) on delete restrict,
  session_id uuid not null,
  code_encrypted text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index owner_drive_oauth_expiry_idx on private.owner_drive_oauth_requests(expires_at);

create table private.owner_drive_folders (
  id text primary key,
  parent_id text,
  course_id uuid references private.courses(id) on delete restrict,
  week integer check (week between 1 and 104),
  kind text not null check (kind in ('root','course','week')),
  created_at timestamptz not null default now(),
  check ((kind='root' and parent_id is null and course_id is null and week is null)
      or (kind='course' and parent_id is not null and course_id is not null and week is null)
      or (kind='week' and parent_id is not null and course_id is not null and week is not null))
);
create unique index owner_drive_course_folder_idx on private.owner_drive_folders(course_id) where kind='course';
create unique index owner_drive_week_folder_idx on private.owner_drive_folders(course_id,week) where kind='week';
create unique index owner_drive_single_root_idx on private.owner_drive_folders((true)) where kind='root';

create table private.teacher_video_upload_access (
  teacher_id uuid primary key references private.app_users(id) on delete restrict,
  enabled boolean not null default false,
  updated_by uuid not null references private.app_users(id) on delete restrict,
  updated_at timestamptz not null default now()
);

create table private.teacher_video_uploads (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references private.app_users(id) on delete restrict,
  course_id uuid not null references private.courses(id) on delete restrict,
  group_id uuid,
  lesson_id uuid not null unique references private.lessons(id) on delete restrict,
  week integer not null check (week between 1 and 104),
  folder_id text not null references private.owner_drive_folders(id) on delete restrict,
  original_name text not null check (char_length(original_name) between 1 and 240),
  file_size bigint not null check (file_size between 1 and 21474836480),
  next_offset bigint not null default 0 check (next_offset >= 0),
  session_uri_encrypted text not null,
  drive_file_id text,
  status text not null default 'uploading' check (status in ('uploading','completed','failed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  foreign key (group_id,course_id) references private.groups(id,course_id) on delete restrict,
  check (next_offset <= file_size),
  check (status <> 'completed' or (drive_file_id is not null and next_offset=file_size))
);
create index teacher_video_uploads_teacher_idx on private.teacher_video_uploads(teacher_id,created_at desc);

create table private.teacher_video_upload_events (
  id bigint generated always as identity primary key,
  upload_id uuid not null references private.teacher_video_uploads(id) on delete restrict,
  actor_id uuid not null references private.app_users(id) on delete restrict,
  action text not null check (action in ('started','progress','completed','failed','cancelled')),
  offset_bytes bigint not null,
  created_at timestamptz not null default now()
);
create index teacher_video_upload_events_upload_idx on private.teacher_video_upload_events(upload_id,created_at);

alter table private.owner_drive_connection enable row level security;
alter table private.owner_drive_connection force row level security;
alter table private.owner_drive_oauth_requests enable row level security;
alter table private.owner_drive_oauth_requests force row level security;
alter table private.owner_drive_folders enable row level security;
alter table private.owner_drive_folders force row level security;
alter table private.teacher_video_upload_access enable row level security;
alter table private.teacher_video_upload_access force row level security;
alter table private.teacher_video_uploads enable row level security;
alter table private.teacher_video_uploads force row level security;
alter table private.teacher_video_upload_events enable row level security;
alter table private.teacher_video_upload_events force row level security;

revoke all on private.owner_drive_connection,private.owner_drive_oauth_requests,private.owner_drive_folders,
 private.teacher_video_upload_access,private.teacher_video_uploads,private.teacher_video_upload_events
 from public,anon,authenticated,service_role;
do $$ begin
 if exists (select 1 from pg_roles where rolname='uyym_backend') then
  grant select,insert,update,delete on private.owner_drive_connection,private.owner_drive_oauth_requests,
   private.owner_drive_folders,private.teacher_video_upload_access,private.teacher_video_uploads,
   private.teacher_video_upload_events to uyym_backend;
  grant usage,select on sequence private.teacher_video_upload_events_id_seq to uyym_backend;
 end if;
end $$;
commit;
