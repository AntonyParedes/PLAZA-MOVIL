import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { financialDatabase as baseDatabase, admin, chief, outsider } from './helpers';
import { readFile } from 'node:fs/promises';
import { earlySettlementQuote } from '../src/lib/finance';

async function financialDatabase() {
 const db=await baseDatabase();
 await db.exec('reset role');
 for(const name of ['202610090003_client_stand.sql','202610100004_loan_2000.sql','202611100005_early_settlement.sql']) {
  await db.exec(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));
 }
 await db.exec(`set role authenticated; set request.jwt.claim.sub='${admin}'`);
 return db;
}

test('descuento manual conserva todo el capital y no devuelve interés cobrado', () => {
 assert.deepEqual(earlySettlementQuote(100000,6000,3000),{interestCents:3000,totalCents:103000});
 assert.deepEqual(earlySettlementQuote(100000,6000,6000),{interestCents:0,totalCents:100000});
 for (const discount of [-1,0,6001,0.5,NaN]) assert.throws(()=>earlySettlementQuote(100000,6000,discount));
 assert.throws(()=>earlySettlementQuote(100000,0,1));
 assert.throws(()=>earlySettlementQuote(0,6000,3000));
});

test('cancelación anticipada atómica, permisos, fechas, reintento y descuento separado de caja',async()=>{
 const db=await financialDatabase();
 try {
  const {today,start}=(await db.query<{today:string;start:string}>("select ((now() at time zone 'America/Lima')::date)::text today,((now() at time zone 'America/Lima')::date-14)::text start")).rows[0];
  const client=(await db.query<{id:string}>("insert into public.clients(stand_code,member_type,full_name,dni,phone,address) values('A-01','socio','Cancelación manual','12345678','999999999','Lima centro') returning id")).rows[0].id;
  const loan=(await db.query<{id:string}>(`select public.create_loan('${randomUUID()}','${client}',100000,600,1,'${start}') id`)).rows[0].id;
  const run=(discount:number,amount=103000,date=today,request=randomUUID())=>db.query<{id:string}>(`select public.settle_loan_early('${request}','${loan}',${amount},${discount},'${date}') id`);
  for(const discount of [-1,0,6001]) await assert.rejects(run(discount));
  await assert.rejects(run(3000,102999),/saldo cambió/);
  await assert.rejects(run(3000,103000,'2099-01-01'),/vencimiento/);
  await assert.rejects(run(3000,103000,'2000-01-01'),/vencimiento/);
  await db.exec(`set request.jwt.claim.sub='${chief}'`);
  await assert.rejects(run(3000),/administrador/);
  await db.exec(`set request.jwt.claim.sub='${admin}'`);
  assert.equal((await db.query('select * from public.payments')).rows.length,0);
  const original=await db.query('select scheduled_cents,due_date from public.installments order by number');
  const request=randomUUID();
  const payment=(await run(3000,103000,today,request)).rows[0].id;
  assert.equal((await run(3000,103000,today,request)).rows[0].id,payment);
  await assert.rejects(run(2999,103000,today,request),/reutilizada/);
  await assert.rejects(run(3000));
  assert.deepEqual((await db.query(`select capital_pending::int capital,interest_pending::int interest,status from public.loans where id='${loan}'`)).rows[0],{capital:0,interest:0,status:'liquidado'});
  assert.deepEqual((await db.query(`select amount_cents::int amount,interest_cents::int interest,capital_cents::int capital,interest_discount_cents::int discount from public.payments where id='${payment}'`)).rows[0],{amount:103000,interest:3000,capital:100000,discount:3000});
  assert.deepEqual((await db.query('select scheduled_cents,due_date from public.installments order by number')).rows,original.rows);
  assert.deepEqual((await db.query('select sum(paid_cents)::int paid,sum(discounted_cents)::int discount,sum(pending_cents)::int pending from public.installment_balances')).rows[0],{paid:103000,discount:3000,pending:0});
  await assert.rejects(db.exec('update public.payments set interest_discount_cents=0'),/permission denied/);
  await assert.rejects(db.exec('delete from public.installment_discounts'),/permission denied/);
  assert.equal((await db.query("select * from public.audit_events where action='loans.settle_early'")).rows.length,1);
  await db.exec(`set request.jwt.claim.sub='${chief}'`);
  assert.equal((await db.query('select * from public.installment_discounts')).rows.length,1);
  await db.exec(`set request.jwt.claim.sub='${outsider}'`);
  assert.equal((await db.query('select * from public.installment_discounts')).rows.length,0);
  await db.exec('reset role; set role anon');
  await assert.rejects(run(3000),/permission denied/);
 } finally {await db.close();}
});

test('abonos previos, descuento total, vencimiento y rollback ante cronograma inconsistente',async()=>{
 const db=await financialDatabase();
 try {
  const {today,start}=(await db.query<{today:string;start:string}>("select ((now() at time zone 'America/Lima')::date)::text today,((now() at time zone 'America/Lima')::date-14)::text start")).rows[0];
  const client=(await db.query<{id:string}>("insert into public.clients(stand_code,member_type,full_name,dni,phone,address) values('A-01','socio','Abono previo','87654321','999999998','Lima centro') returning id")).rows[0].id;
  const loan=(await db.query<{id:string}>(`select public.create_loan('${randomUUID()}','${client}',100000,600,1,'${start}') id`)).rows[0].id;
  await db.exec(`select public.record_payment('${randomUUID()}','${loan}',1000,'${today}')`);
  await assert.rejects(db.exec(`select public.settle_loan_early('${randomUUID()}','${loan}',100000,6000,'${today}')`),/descuento/);
  await assert.rejects(db.exec(`select public.settle_loan_early('${randomUUID()}','${loan}',100000,5000,'${start}')`),/preceder/);
  // Force a missing allocation target to verify the whole mutation rolls back.
  await db.exec('reset role; update public.installments set scheduled_cents=25500 where number=4; set role authenticated');
  await assert.rejects(db.exec(`select public.settle_loan_early('${randomUUID()}','${loan}',100000,5000,'${today}')`),/Cronograma inconsistente/);
  assert.deepEqual((await db.query('select interest_pending::int interest,capital_pending::int capital from public.loans')).rows[0],{interest:5000,capital:100000});
  assert.equal((await db.query('select * from public.payments')).rows.length,1);
  await db.exec('reset role; update public.installments set scheduled_cents=26500 where number=4; set role authenticated');
  await db.exec(`select public.settle_loan_early('${randomUUID()}','${loan}',100000,5000,'${today}')`);
  assert.deepEqual((await db.query('select sum(interest_cents)::int interest,sum(interest_discount_cents)::int discount from public.payments')).rows[0],{interest:1000,discount:5000});
  assert.equal((await db.query<{pending:number}>('select sum(pending_cents)::int pending from public.installment_balances')).rows[0].pending,0);
  const oldLoan=(await db.query<{id:string}>(`select public.create_loan('${randomUUID()}','${client}',100000,600,1,('${today}'::date-28)) id`)).rows[0].id;
  await assert.rejects(db.exec(`select public.settle_loan_early('${randomUUID()}','${oldLoan}',103000,3000,'${today}')`),/vencimiento/);
 } finally {await db.close();}
});

test('cancelación tras refinanciación conserva historial y descuenta solo interés del periodo vigente',async()=>{
 const db=await financialDatabase();
 try {
  const today=(await db.query<{today:string}>("select ((now() at time zone 'America/Lima')::date)::text today")).rows[0].today;
  const client=(await db.query<{id:string}>("insert into public.clients(stand_code,member_type,full_name,dni,phone,address) values('A-01','socio','Refinanciado','12345678','999999999','Lima centro') returning id")).rows[0].id;
  const loan=(await db.query<{id:string}>(`select public.create_loan('${randomUUID()}','${client}',100000,600,1,'${today}') id`)).rows[0].id;
  const ordinaryRequest=randomUUID();
  await db.exec(`select public.record_payment('${ordinaryRequest}','${loan}',6000,'${today}')`);
  await db.exec(`select public.refinance_loan('${randomUUID()}','${loan}')`);
  await db.exec(`select public.record_payment('${randomUUID()}','${loan}',1000,'${today}')`);
  await assert.rejects(db.exec(`select public.settle_loan_early('${ordinaryRequest}','${loan}',6000,3000,'${today}')`),/reutilizada/);
  await db.exec(`select public.settle_loan_early('${randomUUID()}','${loan}',102000,3000,'${today}')`);
  assert.deepEqual((await db.query('select sum(interest_cents)::int interest,sum(capital_cents)::int capital,sum(interest_discount_cents)::int discount from public.payments')).rows[0],{interest:9000,capital:100000,discount:3000});
  assert.equal((await db.query<{pending:number}>('select sum(pending_cents)::int pending from public.installment_balances where is_current')).rows[0].pending,0);
  assert.equal((await db.query<{discount:number}>('select sum(discounted_cents)::int discount from public.installment_balances where not is_current')).rows[0].discount,0);
 } finally {await db.close();}
});
