import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('migración PostgreSQL: RLS, roles, DNI único y auditoría', async () => {
  const db = new PGlite();
  try {
    // Local Auth fixture only. Real Supabase JWT integration still needs external validation.
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      alter default privileges in schema public grant all on tables to anon,authenticated;
      alter default privileges in schema public grant execute on functions to anon,authenticated;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/202610090001_clients_security.sql', import.meta.url), 'utf8'));
    const admin = '11111111-1111-4111-8111-111111111111';
    const chief = '22222222-2222-4222-8222-222222222222';
    const outsider = '33333333-3333-4333-8333-333333333333';
    await db.exec(`insert into auth.users values ('${admin}'), ('${chief}'), ('${outsider}');
      insert into public.profiles(id,role) values ('${admin}','administrador'),('${chief}','jefe');
      set role authenticated;
      set request.jwt.claim.sub = '${admin}';`);
    await db.exec(`insert into public.clients(full_name,dni,phone,address) values ('Cliente prueba','12345678','999999999','Dirección prueba');`);
    assert.equal((await db.query('select * from public.clients')).rows.length, 1);
    assert.equal((await db.query('select * from public.audit_events')).rows.length, 1);
    await assert.rejects(db.exec(`insert into public.clients(full_name,dni,phone,address) values ('Otro cliente','12345678','999999998','Otra dirección');`));
    await assert.rejects(db.exec('delete from public.clients'));
    await assert.rejects(db.exec(`update public.profiles set role='jefe'`));
    await db.exec(`set request.jwt.claim.sub = '${chief}';`);
    assert.equal((await db.query('select * from public.clients')).rows.length, 1);
    await assert.rejects(db.exec(`insert into public.clients(full_name,dni,phone,address) values ('Cliente dos','87654321','999999998','Otra dirección');`));
    assert.equal((await db.query("update public.clients set full_name='Modificado' returning id")).rows.length, 0);
    await assert.rejects(db.exec('delete from public.audit_events'));
    await db.exec(`set request.jwt.claim.sub = '${outsider}';`);
    assert.equal((await db.query('select * from public.clients')).rows.length, 0);
    assert.equal((await db.query('select * from public.audit_events')).rows.length, 0);
    await db.exec('reset role; set role anon;');
    await assert.rejects(db.query('select * from public.clients'));
  } finally { await db.close(); }
});
