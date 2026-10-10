-- OPTIONAL OPERATOR STEP, after all migrations, executed as postgres.
-- Not a migration: do not silently provision a login or commit its password.
-- Current Supabase roles permit a dedicated BYPASSRLS backend role. If your
-- project denies role creation/BYPASSRLS, stop and ask its operator to provision
-- the role; do not grant membership in postgres/service_role as a workaround.
-- For a fresh project only: deliberately fails if this role already exists.
begin;
create role uyym_backend nologin noinherit nosuperuser nocreatedb nocreaterole noreplication bypassrls;
grant usage on schema private to uyym_backend;
grant select,insert,update,delete on all tables in schema private to uyym_backend;
grant usage,select on all sequences in schema private to uyym_backend;
grant execute on all functions in schema private to uyym_backend;
revoke update,delete on private.audit_log from uyym_backend;
alter default privileges in schema private grant select,insert,update,delete on tables to uyym_backend;
alter default privileges in schema private grant usage,select on sequences to uyym_backend;
alter default privileges in schema private grant execute on functions to uyym_backend;
alter role uyym_backend set search_path = pg_catalog,private;
commit;

-- After this script, use an interactive psql session as the project operator:
--   \password uyym_backend
--   ALTER ROLE uyym_backend LOGIN;
-- \password prompts without echo and sends a password hash. Do not put the
-- actual password in this file, shell history, screenshots, or Git.
-- Set DATABASE_URL's username to this role (pooler usernames may require
-- uyym_backend.<project-ref>); keep the connection password in backend secrets.
-- Validate this connection can SELECT private.courses but cannot SELECT
-- auth.users, ALTER private tables, TRUNCATE tables, or SET ROLE postgres.
-- Supabase PUBLIC/extension grants may add ambient privileges: inspect them
-- against the current project, especially pg_net; never revoke PUBLIC CONNECT
-- globally because Supabase system services rely on it.
