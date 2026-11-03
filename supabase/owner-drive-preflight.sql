-- One read-only SELECT returning a single JSON report for migration 009.
-- Reads PostgreSQL catalogs and metadata only; no application rows or secrets.
with
target_role(role_name) as (values ('uyym_backend'::name)),
private_schema as (
  select n.oid, (n.oid is not null) as schema_exists
  from (values (1)) seed(x)
  left join pg_namespace n on n.nspname='private'
),
expected_tables(relname, feature_table) as (
  values ('lessons',false),('groups',false),('courses',false),
         ('owner_drive_connection',true),('owner_drive_oauth_requests',true),
         ('owner_drive_folders',true),('teacher_video_upload_access',true),
         ('teacher_video_uploads',true),('teacher_video_upload_events',true)
),
expected_columns(column_name, expected_type) as (
  values ('drive_file_id','text'),('drive_folder_id','text'),('video_size','bigint')
),
backend as (
  select t.role_name, (r.oid is not null) as role_exists,
         coalesce(r.rolcanlogin,false) as can_login,
         coalesce(r.rolbypassrls,false) as bypass_rls,
         coalesce(r.rolsuper,false) as is_superuser,
         case when r.oid is not null and s.oid is not null
              then has_schema_privilege(r.oid,s.oid,'USAGE') else false end as private_schema_usage
  from target_role t
  left join pg_roles r on r.rolname=t.role_name
  cross join private_schema s
),
table_rows as (
  select e.relname, e.feature_table, (c.oid is not null) as table_exists,
         coalesce(c.relrowsecurity,false) as rls_enabled,
         coalesce(c.relforcerowsecurity,false) as force_rls,
         jsonb_build_object(
           'select',case when c.oid is not null and r.oid is not null then has_table_privilege(r.oid,c.oid,'SELECT') else false end,
           'insert',case when c.oid is not null and r.oid is not null then has_table_privilege(r.oid,c.oid,'INSERT') else false end,
           'update',case when c.oid is not null and r.oid is not null then has_table_privilege(r.oid,c.oid,'UPDATE') else false end,
           'delete',case when c.oid is not null and r.oid is not null then has_table_privilege(r.oid,c.oid,'DELETE') else false end
         ) as backend_grants
  from expected_tables e
  cross join private_schema s
  left join pg_class c on c.relnamespace=s.oid and c.relname=e.relname and c.relkind='r'
  left join pg_roles r on r.rolname='uyym_backend'
),
column_rows as (
  select e.column_name, e.expected_type,
         (a.attnum is not null) as column_exists,
         case when a.attnum is not null then format_type(a.atttypid,a.atttypmod) else null end as actual_type,
         coalesce(a.attnotnull,false) as not_null
  from expected_columns e
  cross join private_schema s
  left join pg_class l on l.relnamespace=s.oid and l.relname='lessons' and l.relkind='r'
  left join pg_attribute a on a.attrelid=l.oid and a.attname=e.column_name and a.attnum>0 and not a.attisdropped
),
group_indexes as (
  select i.indexrelid, i.indisunique, i.indisvalid, i.indisready,
         i.indpred is null as not_partial,
         i.indnkeyatts=2 and i.indnatts=2 as exactly_two_columns,
         pg_get_indexdef(i.indexrelid,1,true)='id'
           and pg_get_indexdef(i.indexrelid,2,true)='course_id' as exact_column_order,
         pg_get_indexdef(i.indexrelid) as definition
  from private_schema s
  join pg_class g on g.relnamespace=s.oid and g.relname='groups' and g.relkind='r'
  join pg_index i on i.indrelid=g.oid
),
sequence_row as (
  select (c.oid is not null) as sequence_exists,
         case when c.oid is not null and r.oid is not null then has_sequence_privilege(r.oid,c.oid,'USAGE') else false end as can_use,
         case when c.oid is not null and r.oid is not null then has_sequence_privilege(r.oid,c.oid,'SELECT') else false end as can_select
  from private_schema s
  left join pg_class c on c.relnamespace=s.oid and c.relname='teacher_video_upload_events_id_seq' and c.relkind='S'
  left join pg_roles r on r.rolname='uyym_backend'
),
browser_roles(role_name) as (values ('anon'::name),('authenticated'::name),('service_role'::name)),
feature_tables(relname) as (
  select relname from expected_tables where feature_table
),
browser_grant_rows as (
  select br.role_name, ft.relname,
         (r.oid is not null) as role_exists,
         (c.oid is not null) as table_exists,
         case when r.oid is not null and s.oid is not null then has_schema_privilege(r.oid,s.oid,'USAGE') else false end as schema_usage,
         jsonb_build_object(
           'select',case when r.oid is not null and c.oid is not null then has_table_privilege(r.oid,c.oid,'SELECT') else false end,
           'insert',case when r.oid is not null and c.oid is not null then has_table_privilege(r.oid,c.oid,'INSERT') else false end,
           'update',case when r.oid is not null and c.oid is not null then has_table_privilege(r.oid,c.oid,'UPDATE') else false end,
           'delete',case when r.oid is not null and c.oid is not null then has_table_privilege(r.oid,c.oid,'DELETE') else false end
         ) as table_grants
  from browser_roles br
  cross join feature_tables ft
  cross join private_schema s
  left join pg_roles r on r.rolname=br.role_name
  left join pg_class c on c.relnamespace=s.oid and c.relname=ft.relname and c.relkind='r'
),
public_acl_rows as (
  select c.relname, acl.privilege_type
  from private_schema s
  join pg_class c on c.relnamespace=s.oid and c.relkind='r'
  join feature_tables ft on ft.relname=c.relname
  cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) as acl
  where acl.grantee=0
)
select jsonb_build_object(
  'backend_role',(select jsonb_build_object(
      'name',role_name,'exists',role_exists,'login',can_login,'bypass_rls',bypass_rls,
      'superuser',is_superuser,'private_schema_usage',private_schema_usage) from backend),
  'private_schema',(select jsonb_build_object('name','private','exists',schema_exists) from private_schema),
  'required_lesson_columns',(select coalesce(jsonb_agg(jsonb_build_object(
      'name',column_name,'exists',column_exists,'expected_type',expected_type,
      'actual_type',actual_type,'not_null',not_null,'type_matches',column_exists and actual_type=expected_type
    ) order by column_name),'[]'::jsonb) from column_rows),
  'groups_unique_id_course_id',(select jsonb_build_object(
      'exists',coalesce(bool_or(indisunique and indisvalid and indisready and not_partial and exactly_two_columns and exact_column_order),false),
      'matching_indexes',coalesce(jsonb_agg(definition order by definition) filter
        (where indisunique and indisvalid and indisready and not_partial and exactly_two_columns and exact_column_order),'[]'::jsonb)
    ) from group_indexes),
  'tables',(select coalesce(jsonb_agg(jsonb_build_object(
      'name',relname,'feature_table',feature_table,'exists',table_exists,
      'rls_enabled',rls_enabled,'force_rls',force_rls,'uyym_backend_grants',backend_grants
    ) order by relname),'[]'::jsonb) from table_rows),
  'upload_event_sequence',(select jsonb_build_object(
      'name','teacher_video_upload_events_id_seq','exists',sequence_exists,
      'uyym_backend_usage',can_use,'uyym_backend_select',can_select) from sequence_row),
  'browser_role_grants',(select coalesce(jsonb_agg(jsonb_build_object(
      'role',role_name,'table',relname,'role_exists',role_exists,'table_exists',table_exists,
      'private_schema_usage',schema_usage,'table_privileges',table_grants
    ) order by role_name,relname),'[]'::jsonb) from browser_grant_rows),
  'public_privileges',(select coalesce(jsonb_agg(jsonb_build_object(
      'table',relname,'privilege',privilege_type) order by relname,privilege_type),'[]'::jsonb) from public_acl_rows)
) as report;
