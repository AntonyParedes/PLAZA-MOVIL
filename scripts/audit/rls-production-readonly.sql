-- Run in Supabase SQL Editor as the project administrator.
-- Catalog metadata only: no customer rows, emails, passwords, JWTs or keys.
-- This does NOT install policies, change privileges or test writes.
begin read only;
with
relations as (
 select c.oid,n.nspname schema_name,c.relname name,c.relkind,
  c.relrowsecurity rls_enabled,c.relforcerowsecurity rls_forced,
  pg_get_userbyid(c.relowner) owner,c.reloptions options,
  case c.relreplident when 'd' then 'default' when 'f' then 'full' when 'i' then 'index' else 'nothing' end replica_identity
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in ('public','storage') and c.relkind in ('r','p','v','m')
),
policies as (
 select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
 from pg_policies where schemaname in ('public','storage')
),
functions as (
 select p.oid,n.nspname schema_name,p.proname name,
  pg_get_function_identity_arguments(p.oid) identity_arguments,
  p.prosecdef security_definer,p.proconfig configuration,pg_get_userbyid(p.proowner) owner,
  md5(p.prosrc) source_hash,
  has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
  exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') public_execute
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prokind='f'
),
public_grants as (
 select n.nspname schema_name,c.relname object_name,a.privilege_type,a.is_grantable
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 cross join lateral aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 'S'::"char" else 'r'::"char" end,c.relowner))) a
 where n.nspname in ('public','storage') and c.relkind in ('r','p','v','m','S') and a.grantee=0
),
effective_privileges as (
 select r.schema_name,r.name,role_name,
  has_table_privilege(role_name,r.oid,'SELECT') can_select,
  has_table_privilege(role_name,r.oid,'INSERT') can_insert,
  has_table_privilege(role_name,r.oid,'UPDATE') can_update,
  has_table_privilege(role_name,r.oid,'DELETE') can_delete,
  has_table_privilege(role_name,r.oid,'TRUNCATE') can_truncate,
  has_table_privilege(role_name,r.oid,'TRIGGER') can_create_trigger,
  has_table_privilege(role_name,r.oid,'REFERENCES') can_reference
 from relations r cross join (values('anon'),('authenticated')) roles(role_name)
),
memberships as (
 select parent.rolname granted_role,member.rolname member_role,m.admin_option
 from pg_auth_members m join pg_roles parent on parent.oid=m.roleid join pg_roles member on member.oid=m.member
 where member.rolname in ('anon','authenticated','service_role') or parent.rolname in ('anon','authenticated','service_role')
),
default_privileges as (
 select pg_get_userbyid(d.defaclrole) creator,coalesce(n.nspname,'ALL_SCHEMAS') schema_name,
  d.defaclobjtype object_type,case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end grantee,a.privilege_type
 from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace
 cross join lateral aclexplode(d.defaclacl) a
 where d.defaclnamespace=0 or n.nspname in ('public','storage')
)
select jsonb_build_object(
 'checked_at_utc',now() at time zone 'UTC',
 'server_version',current_setting('server_version'),
 'relations',coalesce((select jsonb_agg(to_jsonb(r)-'oid' order by r.schema_name,r.name) from relations r),'[]'::jsonb),
 'policies',coalesce((select jsonb_agg(to_jsonb(p) order by p.schemaname,p.tablename,p.policyname) from policies p),'[]'::jsonb),
 'effective_privileges',coalesce((select jsonb_agg(to_jsonb(e) order by e.schema_name,e.name,e.role_name) from effective_privileges e),'[]'::jsonb),
 'public_grants',coalesce((select jsonb_agg(to_jsonb(g) order by g.schema_name,g.object_name,g.privilege_type) from public_grants g),'[]'::jsonb),
 'functions',coalesce((select jsonb_agg(to_jsonb(f)-'oid' order by f.name,f.identity_arguments) from functions f),'[]'::jsonb),
 'api_roles',coalesce((select jsonb_agg(jsonb_build_object('name',rolname,'superuser',rolsuper,'bypass_rls',rolbypassrls,'inherit',rolinherit,'create_role',rolcreaterole)) from pg_roles where rolname in ('anon','authenticated','service_role')),'[]'::jsonb),
 'memberships',coalesce((select jsonb_agg(to_jsonb(m)) from memberships m),'[]'::jsonb),
 'default_privileges',coalesce((select jsonb_agg(to_jsonb(d)) from default_privileges d),'[]'::jsonb),
 'schema_privileges',coalesce((select jsonb_agg(jsonb_build_object('role',rolname,'public_usage',has_schema_privilege(rolname,'public','USAGE'),'public_create',has_schema_privilege(rolname,'public','CREATE'))) from pg_roles where rolname in ('anon','authenticated')),'[]'::jsonb),
 'realtime_tables',coalesce((select jsonb_agg(jsonb_build_object('publication',pubname,'schema',schemaname,'table',tablename) order by pubname,schemaname,tablename) from pg_publication_tables where schemaname in ('public','storage')),'[]'::jsonb)
) as rls_audit;
commit;
