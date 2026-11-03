import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { financialDatabase,admin,chief,outsider } from './helpers';
import { cashSummarySchema } from '../src/lib/cash';

test('penalidad opcional se cobra con liquidación vencida, es atómica, idempotente y separada de capital/interés',async()=>{
 const db=await financialDatabase();
 try {
  await db.exec('reset role');
  for(const name of ['202610090003_client_stand.sql','202610150007_refinance_date_and_term.sql','202610190008_delete_client.sql','202610270009_cash.sql','202611030010_settlement_penalty.sql']) await db.exec(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${admin}'`);
  const {today,start,end}=(await db.query<{today:string;start:string;end:string}>("select ((now() at time zone 'America/Lima')::date)::text today,((now() at time zone 'America/Lima')::date-40)::text start,((now() at time zone 'America/Lima')::date-12)::text end")).rows[0];
  const client=(await db.query<{id:string}>("insert into clients(full_name,dni,phone,address,stand_code,member_type) values('Cliente penalidad','12345678','999999999','Lima centro','A-01','socio') returning id")).rows[0].id;
  const loan=(await db.query<{id:string}>(`select create_loan('${randomUUID()}','${client}',100000,600,1,'${start}') id`)).rows[0].id;
  await db.exec(`select record_cash_movement('${randomUUID()}','apertura',500000,'Capital inicial'); select record_payment('${randomUUID()}','${loan}',25000,'${today}')`);
  const request=randomUUID();
  const settle=(id=request,balance=81000,penalty=5000,reason='Plazo vencido',paid=today)=>db.query<{id:string}>('select settle_loan_with_penalty($1,$2,$3,$4,$5,$6) id',[id,loan,balance,penalty,reason,paid]);
  await assert.rejects(settle(undefined,81001),/saldo cambió/);
  await assert.rejects(settle(undefined,undefined,0),/monto/);
  await assert.rejects(settle(undefined,undefined,-1),/monto/);
  await assert.rejects(settle(undefined,undefined,9007199254740991),/monto/);
  await assert.rejects(settle(undefined,undefined,undefined,' '),/motivo/);
  await assert.rejects(settle(undefined,undefined,undefined,undefined,end),/después de vencer/);
  await assert.rejects(settle(undefined,undefined,undefined,undefined,'2099-01-01'),/futura/);
  for(const identity of [chief,outsider]) {await db.exec(`set request.jwt.claim.sub='${identity}'`);await assert.rejects(settle(),/administrador/);}
  await db.exec('reset role; set role anon');await assert.rejects(settle(),/permission denied/);
  await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub='${admin}'`);
  await assert.rejects(db.exec('update payments set penalty_cents=1'),/permission denied/);
  // A failure on the penalty write must also undo the underlying settlement.
  await db.exec("reset role; create function reject_penalty_test() returns trigger language plpgsql as $$ begin if new.penalty_cents>0 then raise exception 'Test rollback'; end if; return new; end $$; create trigger reject_penalty_test before update on payments for each row execute function reject_penalty_test(); set role authenticated");
  await assert.rejects(settle(),/Test rollback/);
  assert.equal((await db.query('select * from payments')).rows.length,1);
  assert.equal((await db.query<{status:string}>(`select status from loans where id='${loan}'`)).rows[0].status,'activo');
  await db.exec('reset role; drop trigger reject_penalty_test on payments; drop function reject_penalty_test(); set role authenticated');
  const payment=(await settle()).rows[0].id;
  assert.equal((await settle()).rows[0].id,payment);
  await assert.rejects(settle(undefined,undefined,5001),/datos distintos/);
  await assert.rejects(settle(randomUUID()),/liquidado/);
  const row=(await db.query<{amount_cents:string;capital_cents:string;interest_cents:string;penalty_cents:string}>(`select amount_cents::text,capital_cents::text,interest_cents::text,penalty_cents::text from payments where id='${payment}'`)).rows[0];
  assert.deepEqual(row,{amount_cents:'81000',capital_cents:'81000',interest_cents:'0',penalty_cents:'5000'});
  assert.ok((await db.query<{pending_cents:number}>('select pending_cents from installment_balances')).rows.every(i=>Number(i.pending_cents)===0));
  const summary=cashSummarySchema.parse((await db.query<{s:unknown}>('select cash_summary() s')).rows[0].s);
  assert.equal(summary.balance_cents,'511000');assert.equal(summary.received_cents,'111000');assert.equal(summary.interest_cents,'6000');assert.equal(summary.penalty_cents,'5000');
  assert.equal((await db.query("select * from audit_events where action='payments.penalty'")).rows.length,1);
  const register=(await db.query<{reason:string;amount_cents:string}>('select reason,amount_cents::text from penalty_register')).rows;
  assert.deepEqual(register,[{reason:'Plazo vencido',amount_cents:'5000'}]);
  assert.equal((await db.query<{allowed:boolean}>("select has_table_privilege('authenticated','public.penalty_register','DELETE') allowed")).rows[0].allowed,false);
  await assert.rejects(db.exec('delete from penalty_register'),/cannot delete from view/);
  await db.exec(`set request.jwt.claim.sub='${chief}'`);
  assert.equal((await db.query('select * from penalty_register')).rows.length,1);
  await db.exec(`set request.jwt.claim.sub='${outsider}'`);
  assert.equal((await db.query('select * from penalty_register')).rows.length,0);
  await db.exec(`set request.jwt.claim.sub='${admin}'`);
  const preview=(await db.query<{s:{paid_cents:string;confirmation_token:string}}>(`select preview_client_deletion('${client}') s`)).rows[0].s;
  assert.equal(preview.paid_cents,'111000');
  // A current period cannot receive a penalty even if weekly installments are late.
  const currentLoan=(await db.query<{id:string}>(`select create_loan('${randomUUID()}','${client}',50000,700,1,'${end}') id`)).rows[0].id;
  await assert.rejects(db.query('select settle_loan_with_penalty($1,$2,53500,1000,$3,$4)',[randomUUID(),currentLoan,'Atraso semanal',today]),/después de vencer/);
  // Optional: full regular settlement remains valid and does not invent a penalty.
  await db.exec(`select record_payment('${randomUUID()}','${currentLoan}',53500,'${today}')`);
  assert.equal((await db.query<{penalty_cents:string}>(`select penalty_cents::text from payments where loan_id='${currentLoan}'`)).rows[0].penalty_cents,'0');
  const updated=(await db.query<{s:{confirmation_token:string}}>(`select preview_client_deletion('${client}') s`)).rows[0].s;
  await db.exec(`select delete_client('${client}','12345678','Registro por error','${updated.confirmation_token}')`);
  const after=cashSummarySchema.parse((await db.query<{s:unknown}>('select cash_summary() s')).rows[0].s);
  assert.equal(after.penalty_cents,'0');assert.equal(after.balance_cents,'500000');
 } finally {await db.close();}
});
