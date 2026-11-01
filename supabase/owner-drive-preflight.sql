-- READ ONLY. Run with the backend connection, before and after migration 009.
-- Never paste DATABASE_URL into this file or a SQL editor. No user rows returned.
begin read only;
select current_user as effective_role, session_user as login_role,
       rolcanlogin, rolbypassrls, rolsuper,
       has_schema_privilege(current_user,'private','USAGE') as private_usage
from pg_roles where rolname=current_user;

select c.relname, c.relrowsecurity, c.relforcerowsecurity,
       has_table_privilege(current_user,c.oid,'SELECT') as can_select,
       has_table_privilege(current_user,c.oid,'INSERT') as can_insert,
       has_table_privilege(current_user,c.oid,'UPDATE') as can_update,
       has_table_privilege(current_user,c.oid,'DELETE') as can_delete
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='private' and c.relkind='r'
  and c.relname in ('lessons','groups','courses','owner_drive_connection',
      'owner_drive_oauth_requests','owner_drive_folders','teacher_video_upload_access',
      'teacher_video_uploads','teacher_video_upload_events')
order by c.relname;

select column_name,data_type,is_nullable
from information_schema.columns
where table_schema='private' and table_name='lessons'
  and column_name in ('drive_file_id','drive_folder_id','video_size');

select indexdef from pg_indexes
where schemaname='private' and tablename='groups';

select c.relname,
       has_sequence_privilege(current_user,c.oid,'USAGE') as can_use,
       has_sequence_privilege(current_user,c.oid,'SELECT') as can_select
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='private' and c.relkind='S'
  and c.relname='teacher_video_upload_events_id_seq';

select r.rolname,c.relname,
       has_schema_privilege(r.oid,n.oid,'USAGE') as schema_access,
       has_table_privilege(r.oid,c.oid,'SELECT') as can_select,
       has_table_privilege(r.oid,c.oid,'INSERT') as can_insert,
       has_table_privilege(r.oid,c.oid,'UPDATE') as can_update,
       has_table_privilege(r.oid,c.oid,'DELETE') as can_delete
from pg_roles r cross join pg_class c join pg_namespace n on n.oid=c.relnamespace
where r.rolname in ('anon','authenticated','service_role')
  and n.nspname='private' and c.relname in ('owner_drive_connection',
      'owner_drive_oauth_requests','owner_drive_folders','teacher_video_upload_access',
      'teacher_video_uploads','teacher_video_upload_events')
order by r.rolname,c.relname;
rollback;
