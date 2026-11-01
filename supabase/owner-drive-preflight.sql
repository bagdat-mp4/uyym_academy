-- Read-only catalog check for migration 009. Safe to run from Supabase SQL Editor.
-- It inspects metadata and grants only; it never reads application rows or secrets.
begin read only;

-- Check the actual backend role by name. SQL Editor's current_user may be postgres,
-- which is not the role used by Render's DATABASE_URL.
with target(role_name) as (values ('uyym_backend'::name))
select target.role_name, (r.oid is not null) as role_exists,
       r.rolcanlogin, r.rolbypassrls, r.rolsuper,
       case when r.oid is not null and n.oid is not null
            then has_schema_privilege(r.oid,n.oid,'USAGE') else false end as private_usage
from target
left join pg_roles r on r.rolname=target.role_name
left join pg_namespace n on n.nspname='private';

-- Explicitly show each expected table, including missing tables, and the grants
-- migration 009 requires for uyym_backend.
with expected(relname) as (
  values ('lessons'),('groups'),('courses'),('owner_drive_connection'),
         ('owner_drive_oauth_requests'),('owner_drive_folders'),
         ('teacher_video_upload_access'),('teacher_video_uploads'),
         ('teacher_video_upload_events')
)
select e.relname, (c.oid is not null) as table_exists,
       coalesce(c.relrowsecurity,false) as rls_enabled,
       coalesce(c.relforcerowsecurity,false) as force_rls,
       case when c.oid is not null and r.oid is not null then has_table_privilege(r.oid,c.oid,'SELECT') else false end as can_select,
       case when c.oid is not null and r.oid is not null then has_table_privilege(r.oid,c.oid,'INSERT') else false end as can_insert,
       case when c.oid is not null and r.oid is not null then has_table_privilege(r.oid,c.oid,'UPDATE') else false end as can_update,
       case when c.oid is not null and r.oid is not null then has_table_privilege(r.oid,c.oid,'DELETE') else false end as can_delete
from expected e
left join pg_namespace n on n.nspname='private'
left join pg_class c on c.relnamespace=n.oid and c.relname=e.relname and c.relkind='r'
left join pg_roles r on r.rolname='uyym_backend'
order by e.relname;

-- Required lesson metadata columns, without reading lesson records.
select column_name,data_type,is_nullable
from information_schema.columns
where table_schema='private' and table_name='lessons'
  and column_name in ('drive_file_id','drive_folder_id','video_size')
order by column_name;

-- A unique index on exactly (id, course_id) is required by migration 009's FK.
select indexname,indexdef
from pg_indexes
where schemaname='private' and tablename='groups'
  and indexdef ilike 'CREATE UNIQUE INDEX%'
order by indexname;

-- Verify the identity sequence used by upload activity events.
with target(relname) as (values ('teacher_video_upload_events_id_seq'))
select t.relname, (c.oid is not null) as sequence_exists,
       case when c.oid is not null and r.oid is not null then has_sequence_privilege(r.oid,c.oid,'USAGE') else false end as can_use,
       case when c.oid is not null and r.oid is not null then has_sequence_privilege(r.oid,c.oid,'SELECT') else false end as can_select
from target t
left join pg_namespace n on n.nspname='private'
left join pg_class c on c.relnamespace=n.oid and c.relname=t.relname and c.relkind='S'
left join pg_roles r on r.rolname='uyym_backend';

-- Browser/service roles must have no direct privileges on the six new tables.
with roles(role_name) as (values ('anon'::name),('authenticated'::name),('service_role'::name)),
tables(relname) as (
  values ('owner_drive_connection'),('owner_drive_oauth_requests'),('owner_drive_folders'),
         ('teacher_video_upload_access'),('teacher_video_uploads'),('teacher_video_upload_events')
)
select roles.role_name, tables.relname,
       (r.oid is not null) as role_exists,
       (c.oid is not null) as table_exists,
       case when r.oid is not null and n.oid is not null then has_schema_privilege(r.oid,n.oid,'USAGE') else false end as schema_access,
       case when r.oid is not null and c.oid is not null then has_table_privilege(r.oid,c.oid,'SELECT') else false end as can_select,
       case when r.oid is not null and c.oid is not null then has_table_privilege(r.oid,c.oid,'INSERT') else false end as can_insert,
       case when r.oid is not null and c.oid is not null then has_table_privilege(r.oid,c.oid,'UPDATE') else false end as can_update,
       case when r.oid is not null and c.oid is not null then has_table_privilege(r.oid,c.oid,'DELETE') else false end as can_delete
from roles cross join tables
left join pg_roles r on r.rolname=roles.role_name
left join pg_namespace n on n.nspname='private'
left join pg_class c on c.relnamespace=n.oid and c.relname=tables.relname and c.relkind='r'
order by roles.role_name,tables.relname;

-- Empty result is required: no PUBLIC ACL entry on these private tables.
select c.relname, acl.privilege_type
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) as acl
where n.nspname='private' and c.relkind='r'
  and c.relname in ('owner_drive_connection','owner_drive_oauth_requests','owner_drive_folders',
      'teacher_video_upload_access','teacher_video_uploads','teacher_video_upload_events')
  and acl.grantee=0
order by c.relname,acl.privilege_type;

rollback;
