import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
export const admin = '11111111-1111-4111-8111-111111111111';
export const chief = '22222222-2222-4222-8222-222222222222';
export const outsider = '33333333-3333-4333-8333-333333333333';
export async function financialDatabase() {
 const db = new PGlite();
 await db.exec(`create role anon; create role authenticated; create schema auth;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 alter default privileges in schema public grant all on tables to anon,authenticated;
 alter default privileges in schema public grant execute on functions to anon,authenticated;
 grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
 for(const name of ['202610090001_clients_security.sql','202610090002_financial_operations.sql']) {
  await db.exec(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));
 }
 await db.exec(`insert into auth.users values('${admin}'),('${chief}'),('${outsider}');
 insert into public.profiles(id,role) values('${admin}','administrador'),('${chief}','jefe');
 set role authenticated; set request.jwt.claim.sub='${admin}';`);
 return db;
}
