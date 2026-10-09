import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {financialDatabase,chief} from './helpers';
test('nueva migración conserva clientes y préstamos existentes; obliga identificar nuevos y mantiene roles',async()=>{
 const db=await financialDatabase();
 try{
  const client=(await db.query<{id:string}>("insert into public.clients(full_name,dni,phone,address) values('Cliente existente','12345678','999999999','Lima centro') returning id")).rows[0].id;
  const today=(await db.query<{today:string}>("select ((now() at time zone 'America/Lima')::date)::text today")).rows[0].today;
  const loan=(await db.query<{id:string}>(`select public.create_loan('${randomUUID()}','${client}',100000,600,1,'${today}') id`)).rows[0].id;
  await db.exec('reset role');
  await db.exec(await readFile(new URL('../supabase/migrations/202610090003_client_stand.sql',import.meta.url),'utf8'));
  await db.exec('set role authenticated');
  assert.deepEqual((await db.query('select stand_code,member_type from public.clients')).rows,[{stand_code:null,member_type:null}]);
  assert.equal((await db.query('select id from public.loans')).rows.length,1);
  await db.exec(`select public.record_payment('${randomUUID()}','${loan}',100,'${today}')`);
  await db.exec(`select public.record_payment('${randomUUID()}','${loan}',105900,'${today}')`);
  await assert.rejects(db.exec(`select public.create_loan('${randomUUID()}','${client}',50000,700,1,'${today}')`),/Completa código/);
  await assert.rejects(db.exec("insert into public.clients(full_name,dni,phone,address) values('Nuevo cliente','87654321','999999998','Lima centro')"));
  await db.exec(`update public.clients set stand_code='A-01',member_type='socio' where id='${client}'`);
  await db.exec(`select public.create_loan('${randomUUID()}','${client}',50000,700,1,'${today}')`);
  await assert.rejects(db.exec(`update public.clients set member_type='otro' where id='${client}'`));
  await assert.rejects(db.exec(`update public.clients set stand_code='' where id='${client}'`));
  // Workers and partners can share a stand; do not invent a uniqueness requirement.
  await db.exec("insert into public.clients(full_name,dni,phone,address,stand_code,member_type) values('Trabajador','87654321','999999998','Lima centro','A-01','trabajador')");
  await db.exec(`set request.jwt.claim.sub='${chief}'`);
  assert.equal((await db.query('select stand_code from public.clients')).rows.length,2);
  assert.equal((await db.query("update public.clients set stand_code='B-02' returning id")).rows.length,0);
 }finally{await db.close();}
});
