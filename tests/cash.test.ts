import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { financialDatabase, admin, chief, outsider } from './helpers';
import { cashMoney, cashSummarySchema } from '../src/lib/cash';

test('caja distingue dinero disponible, capital recuperado e interés cobrado, sin duplicar refinanciaciones', async () => {
 const db=await financialDatabase();
 try {
  await db.exec('reset role');
  for (const name of ['202610090003_client_stand.sql','202610150007_refinance_date_and_term.sql','202610190008_delete_client.sql','202610270009_cash.sql']) await db.exec(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));
  // Safe to re-run the additive migration without modifying recorded movements.
  await db.exec(await readFile(new URL('../supabase/migrations/202610270009_cash.sql',import.meta.url),'utf8'));
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${admin}'`);
  const summary=async()=>cashSummarySchema.parse((await db.query<{s:unknown}>('select cash_summary() s')).rows[0].s);
  let s=await summary();assert.equal(s.configured,false);assert.equal(s.balance_cents,null);assert.equal(s.interest_cents,'0');
  const record=(id:string,kind:string,amount:number,note='Aporte registrado')=>db.query<{id:string}>('select record_cash_movement($1,$2,$3,$4) id',[id,kind,amount,note]);
  await assert.rejects(record(randomUUID(),'aporte',100), /dinero inicial/);
  await assert.rejects(record(randomUUID(),'apertura',-1), /importe/);
  await assert.rejects(record(randomUUID(),'invalido',100), /tipo/);
  await assert.rejects(record(randomUUID(),'apertura',100,' '), /motivo/);
  const request=randomUUID();const opening=await record(request,'apertura',500000,'Capital inicial');
  assert.equal((await record(request,'apertura',500000,'Capital inicial')).rows[0].id,opening.rows[0].id);
  await assert.rejects(record(request,'apertura',500001,'Capital inicial'), /datos distintos/);
  await assert.rejects(record(randomUUID(),'apertura',0), /ya tiene/);
  await assert.rejects(record(randomUUID(),'retiro',0), /importe/);
  await record(randomUUID(),'aporte',100000);await record(randomUUID(),'retiro',20000,'Retiro registrado');
  const client=(await db.query<{id:string}>("insert into clients(full_name,dni,phone,address,stand_code,member_type) values('Caja Cliente','12345678','999999999','Lima centro','A-01','socio') returning id")).rows[0].id;
  const {today,start}=(await db.query<{today:string;start:string}>("select ((now() at time zone 'America/Lima')::date)::text today,((now() at time zone 'America/Lima')::date-100)::text start")).rows[0];
  const loan=(await db.query<{id:string}>(`select create_loan('${randomUUID()}','${client}',100000,600,1,'${start}') id`)).rows[0].id;
  await db.exec(`select record_payment('${randomUUID()}','${loan}',25000,'${start}')`);
  s=await summary();assert.equal(s.balance_cents,'505000');assert.equal(s.interest_cents,'6000');assert.equal(s.month_interest_cents,'0');assert.equal(s.disbursed_cents,'100000');
  await db.exec(`select refinance_loan('${randomUUID()}','${loan}','${today}',2)`);
  s=await summary();assert.equal(s.balance_cents,'505000');assert.equal(s.interest_cents,'6000');assert.equal(s.disbursed_cents,'100000');
  await db.exec(`select record_payment('${randomUUID()}','${loan}',20000,'${today}')`);
  s=await summary();assert.equal(s.balance_cents,'525000');assert.equal(s.interest_cents,'18000');assert.equal(s.month_interest_cents,'12000');assert.equal(s.received_cents,'45000');
  await db.exec(`select record_payment('${randomUUID()}','${loan}',73000,'${today}')`);
  s=await summary();assert.equal(s.balance_cents,'598000');assert.equal(s.interest_cents,'18000');assert.equal(s.disbursed_cents,'100000');
  await db.exec(`set request.jwt.claim.sub='${chief}'`);
  assert.deepEqual(await summary(),s);
  assert.equal((await db.query('select * from cash_movements')).rows.length,3);
  await assert.rejects(record(randomUUID(),'aporte',100), /administrador/);
  await db.exec(`set request.jwt.claim.sub='${outsider}'`);
  await assert.rejects(summary(), /autorizado/);
  assert.equal((await db.query('select * from cash_movements')).rows.length,0);
  await db.exec('reset role; set role anon');
  await assert.rejects(summary(), /permission denied/);
  await assert.rejects(record(randomUUID(),'aporte',100), /permission denied/);
  await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub='${admin}'`);
  for (const sql of ["delete from cash_movements","update cash_movements set amount_cents=1",`insert into cash_movements(request_id,kind,amount_cents,note,actor_id) values('${randomUUID()}','aporte',100,'Directo','${admin}')`]) await assert.rejects(db.exec(sql), /permission denied/);
  assert.equal((await db.query("select * from audit_events where action like 'cash.%'")).rows.length,3);
  // Erroneous borrower deletion follows the existing rule: remove its fictional cash flows too.
  const token=(await db.query<{token:string}>(`select preview_client_deletion('${client}')->>'confirmation_token' token`)).rows[0].token;
  await db.exec(`select delete_client('${client}','12345678','Registro equivocado','${token}')`);
  s=await summary();assert.equal(s.balance_cents,'580000');assert.equal(s.interest_cents,'0');assert.equal(s.disbursed_cents,'0');assert.equal(s.received_cents,'0');
  await record(randomUUID(),'retiro',600000,'Retiro para conciliar');
  assert.equal((await summary()).balance_cents,'-20000');
 } finally {await db.close();}
});

test('caja permite apertura cero y conserva precisión en saldos grandes o negativos', async()=>{
 const db=await financialDatabase();
 try {
  await db.exec('reset role');await db.exec(await readFile(new URL('../supabase/migrations/202610270009_cash.sql',import.meta.url),'utf8'));await db.exec(`set role authenticated; set request.jwt.claim.sub='${admin}'`);
  await db.exec(`select record_cash_movement('${randomUUID()}','apertura',0,'Sin capital inicial')`);
  for(let i=0;i<2;i++)await db.exec(`select record_cash_movement('${randomUUID()}','aporte',9007199254740991,'Aporte de prueba')`);
  const s=cashSummarySchema.parse((await db.query<{s:unknown}>('select cash_summary() s')).rows[0].s);
  assert.equal(s.balance_cents,'18014398509481982');
  assert.match(cashMoney(s.balance_cents!),/\.82$/);
  assert.match(cashMoney('-20000'),/−S\/\s*200\.00/);
  assert.equal(cashSummarySchema.safeParse({...s,configured:false}).success,false);
 } finally {await db.close();}
});
