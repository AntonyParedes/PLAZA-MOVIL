import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { financialDatabase, admin, chief, outsider } from './helpers';

test('eliminación íntegra, confirmada y exclusiva del administrador; conserva otros clientes y accesos', async () => {
 const db = await financialDatabase();
 try {
  await db.exec('reset role');
  await db.exec(await readFile(new URL('../supabase/migrations/202610190008_delete_client.sql', import.meta.url), 'utf8'));
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${admin}'`);
  const createClient = async (dni: string) => (await db.query<{id:string}>(`insert into clients(full_name,dni,phone,address) values('Cliente prueba','${dni}','999999999','Lima centro') returning id`)).rows[0].id;
  const client = await createClient('12345678'), other = await createClient('87654321');
  const today = (await db.query<{today:string}>("select ((now() at time zone 'America/Lima')::date)::text today")).rows[0].today;
  const loan = (await db.query<{id:string}>(`select create_loan('${randomUUID()}','${client}',100000,600,1,'${today}') id`)).rows[0].id;
  const otherLoan = (await db.query<{id:string}>(`select create_loan('${randomUUID()}','${other}',50000,700,1,'${today}') id`)).rows[0].id;
  await db.exec(`select record_payment('${randomUUID()}','${loan}',25000,'${today}'); select refinance_loan('${randomUUID()}','${loan}'); select record_payment('${randomUUID()}','${loan}',1000,'${today}'); select record_payment('${randomUUID()}','${otherLoan}',1000,'${today}')`);
  type Snapshot={confirmation_token:string;loans_count:number;payments_count:number;balance_cents:string;paid_cents:string};
  const preview = async () => (await db.query<{s:Snapshot}>(`select preview_client_deletion('${client}') s`)).rows[0].s;
  const summary = await preview();
  assert.equal(summary.loans_count,1); assert.equal(summary.payments_count,2); assert.equal(summary.paid_cents,'26000'); assert.equal(summary.balance_cents,'86000');
  const remove = (token=summary.confirmation_token, dni='12345678', reason='Registro por error') => db.query<{id:string}>(`select delete_client('${client}','${dni}','${reason}','${token}') id`);
  await assert.rejects(remove(undefined,'87654321'), /DNI/);
  await assert.rejects(remove(undefined,undefined,' '), /motivo/);
  await assert.rejects(remove('f'.repeat(32)), /datos cambiaron/);
  await assert.rejects(db.exec(`select client_deletion_snapshot('${client}')`), /permission denied/);
  for (const identity of [chief, outsider]) {
   await db.exec(`set request.jwt.claim.sub='${identity}'`);
   await assert.rejects(preview(), /administrador/);
   await assert.rejects(remove(), /administrador/);
  }
  await db.exec('reset role; set role anon');
  await assert.rejects(preview(), /permission denied/);
  await assert.rejects(remove(), /permission denied/);
  await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub='${admin}'`);
  await assert.rejects(db.exec('delete from clients'), /permission denied/);
  await assert.rejects(db.exec('delete from payments'), /permission denied/);
  await assert.rejects(db.exec('delete from client_deletions'), /permission denied/);
  await db.exec(`select record_payment('${randomUUID()}','${loan}',1000,'${today}')`);
  await assert.rejects(remove(), /datos cambiaron/);
  const latest = await preview();
  // Simulate a database failure after child rows have been removed: the entire RPC must roll back.
  await db.exec(`reset role; create function public.reject_test_delete() returns trigger language plpgsql as $$ begin raise exception 'Test rollback'; end $$; create trigger reject_test_delete before delete on clients for each row execute function reject_test_delete(); set role authenticated`);
  await assert.rejects(remove(latest.confirmation_token), /Test rollback/);
  assert.equal((await db.query(`select * from loans where client_id='${client}'`)).rows.length,1);
  assert.equal((await db.query(`select * from payments where loan_id='${loan}'`)).rows.length,3);
  assert.equal((await db.query('select * from client_deletions')).rows.length,0);
  await db.exec('reset role; drop trigger reject_test_delete on clients; drop function reject_test_delete(); set role authenticated');
  assert.equal((await remove(latest.confirmation_token)).rows[0].id,client);
  assert.equal((await remove(latest.confirmation_token)).rows[0].id,client); // Safe retry after a lost response.
  for (const table of ['clients','loans','loan_periods','payments']) {
   const rows=(await db.query(`select * from ${table}`)).rows;
   assert.equal(rows.length,1,table);
  }
  assert.equal((await db.query('select * from installments')).rows.length,4);
  assert.equal((await db.query('select * from payment_installments')).rows.length,1);
  assert.equal((await db.query(`select * from clients where id='${other}'`)).rows.length,1);
  assert.equal((await db.query('select * from profiles')).rows.length,1); // RLS exposes only the caller's own profile.
  await db.exec('reset role');
  assert.equal((await db.query('select * from profiles')).rows.length,2);
  assert.equal((await db.query('select * from auth.users')).rows.length,3);
  await db.exec('set role authenticated');
  const audit=(await db.query<{reason:string;actor_id:string}>('select * from client_deletions')).rows;
  assert.equal(audit.length,1); assert.equal(audit[0].actor_id,admin); assert.equal(audit[0].reason,'Registro por error');
  assert.equal((await db.query("select * from audit_events where action='clients.delete'")).rows.length,1);
  await db.exec(`set request.jwt.claim.sub='${chief}'`);
  assert.equal((await db.query('select * from client_deletions')).rows.length,0);
  await db.exec(`set request.jwt.claim.sub='${admin}'`);
  const empty=await createClient('11223344');
  const token=(await db.query<{token:string}>(`select preview_client_deletion('${empty}')->>'confirmation_token' token`)).rows[0].token;
  await db.exec(`select delete_client('${empty}','11223344','Duplicado','${token}')`);
  await assert.rejects(db.exec(`select delete_client('${randomUUID()}','11223344','Duplicado','${token}')`), /inexistente/);
 } finally { await db.close(); }
});

test('eliminación compatible con identificación y refinanciación vigente de uno o dos meses', async () => {
 const db=await financialDatabase();
 try {
  await db.exec('reset role');
  for (const name of ['202610090003_client_stand.sql','202610150007_refinance_date_and_term.sql','202610190008_delete_client.sql']) {
   await db.exec(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));
  }
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${admin}'`);
  const client=(await db.query<{id:string}>("insert into clients(full_name,dni,phone,address,stand_code,member_type) values('Cliente vigente','12345678','999999999','Lima centro','A-01','socio') returning id")).rows[0].id;
  const {today,start}=(await db.query<{today:string;start:string}>("select ((now() at time zone 'America/Lima')::date)::text today,((now() at time zone 'America/Lima')::date-40)::text start")).rows[0];
  const loan=(await db.query<{id:string}>(`select create_loan('${randomUUID()}','${client}',150000,600,1,'${start}') id`)).rows[0].id;
  await db.exec(`select record_payment('${randomUUID()}','${loan}',25000,'${today}'); select refinance_loan('${randomUUID()}','${loan}','${today}',2)`);
  const summary=(await db.query<{s:{stand_code:string;confirmation_token:string}}>(`select preview_client_deletion('${client}') s`)).rows[0].s;
  assert.equal(summary.stand_code,'A-01');
  await db.exec(`select delete_client('${client}','12345678','Registro por error','${summary.confirmation_token}')`);
  for (const table of ['clients','loans','loan_periods','installments','payments','payment_installments']) assert.equal((await db.query(`select * from ${table}`)).rows.length,0,table);
 } finally { await db.close(); }
});
