import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { financialDatabase, chief, admin, outsider } from './helpers';

test('préstamo, pagos, refinanciación y liquidación atómicos en PostgreSQL', async () => {
 const db=await financialDatabase();
 try {
  const date=(await db.query<{today:string}>("select ((now() at time zone 'America/Lima')::date)::text today")).rows[0].today;
  const client=(await db.query<{id:string}>("insert into public.clients(full_name,dni,phone,address) values('Cliente real','12345678','999999999','Lima centro') returning id")).rows[0].id;
  const request=randomUUID();
  const sql=`select public.create_loan('${request}','${client}',100000,600,1,'${date}') id`;
  const loan=(await db.query<{id:string}>(sql)).rows[0].id;
  assert.equal((await db.query<{id:string}>(sql)).rows[0].id,loan);
  await assert.rejects(db.exec(`select public.create_loan('${request}','${client}',50000,700,1,'${date}')`));
  await assert.rejects(db.exec(`select public.create_loan('${randomUUID()}','${client}',50000,700,1,'${date}')`));
  const plan=await db.query<{scheduled_cents:number}>(`select scheduled_cents::int from public.installments where period_id in(select id from public.loan_periods where loan_id='${loan}') order by number`);
  assert.deepEqual(plan.rows.map(row=>row.scheduled_cents),[26500,26500,26500,26500]);
  await assert.rejects(db.exec(`select public.generate_installments((select id from public.loan_periods where loan_id='${loan}' and is_current))`),/permission denied/);
  await assert.rejects(db.exec('select public.require_admin()'),/permission denied/);
  await assert.rejects(db.exec(`select public.refinance_loan('${randomUUID()}','${loan}')`));
  const paymentRequest=randomUUID();
  const paymentSQL=`select public.record_payment('${paymentRequest}','${loan}',25000,'${date}') id`;
  const payment=(await db.query<{id:string}>(paymentSQL)).rows[0].id;
  assert.equal((await db.query<{id:string}>(paymentSQL)).rows[0].id,payment);
  await assert.rejects(db.exec(`select public.record_payment('${paymentRequest}','${loan}',25001,'${date}')`));
  let balance=(await db.query<{capital:number;interest:number}>(`select capital_pending::int capital,interest_pending::int interest from public.loans where id='${loan}'`)).rows[0];
  assert.deepEqual(balance,{capital:81000,interest:0});
  const refinancing=randomUUID();
  const period=(await db.query<{id:string}>(`select public.refinance_loan('${refinancing}','${loan}') id`)).rows[0].id;
  assert.equal((await db.query<{id:string}>(`select public.refinance_loan('${refinancing}','${loan}') id`)).rows[0].id,period);
  const newPlan=await db.query<{scheduled_cents:number}>(`select scheduled_cents::int from public.installments where period_id='${period}' order by number`);
  assert.deepEqual(newPlan.rows.map(row=>row.scheduled_cents),[21750,21750,21750,21750]);
  balance=(await db.query<{capital:number;interest:number}>(`select capital_pending::int capital,interest_pending::int interest from public.loans where id='${loan}'`)).rows[0];
  assert.deepEqual(balance,{capital:81000,interest:6000});
  assert.equal((await db.query(`select * from public.loan_periods where loan_id='${loan}'`)).rows.length,2);
  const settlement=(await db.query<{start_date:string}>(`select start_date::text from public.loan_periods where id='${period}'`)).rows[0].start_date;
  assert.equal(settlement,date);
  await assert.rejects(db.exec(`select public.record_payment('${randomUUID()}','${loan}',87001,'${date}')`));
  assert.equal((await db.query('select * from public.payments')).rows.length,1);
  await db.exec(`select public.record_payment('${randomUUID()}','${loan}',87000,'${date}')`);
  assert.equal((await db.query<{status:string}>(`select status from public.loans where id='${loan}'`)).rows[0].status,'liquidado');
  assert.ok((await db.query<{status:string}>(`select status from public.installment_balances where period_id='${period}'`)).rows.every(row=>row.status==='pagado'));
  await assert.rejects(db.exec(`select public.refinance_loan('${randomUUID()}','${loan}')`));
  await assert.rejects(db.exec('delete from public.payments'));
  await assert.rejects(db.exec('update public.payments set amount_cents=1'));
  await assert.rejects(db.exec('delete from public.loans'));
  await db.exec(`select public.create_loan('${randomUUID()}','${client}',50000,700,1,'${date}')`);
  await db.exec(`set request.jwt.claim.sub='${chief}'`);
  assert.equal((await db.query('select * from public.loans')).rows.length,2);
  await assert.rejects(db.exec(`select public.record_payment('${randomUUID()}','${loan}',1,'${date}')`));
  await assert.rejects(db.exec(`select public.create_loan('${randomUUID()}','${client}',50000,700,1,'${date}')`));
  await db.exec(`set request.jwt.claim.sub='${outsider}'`);
  assert.equal((await db.query('select * from public.installment_balances')).rows.length,0);
  await db.exec('reset role; set role anon');
  await assert.rejects(db.query('select * from public.payments'));
 } finally {await db.close();}
});

test('vencidos se acumulan sin cambiar fechas; impiden refinanciar aunque interés esté pagado',async()=>{
 const db=await financialDatabase();
 try {
  const {today,start}=(await db.query<{today:string;start:string}>("select ((now() at time zone 'America/Lima')::date)::text today,((now() at time zone 'America/Lima')::date-21)::text start")).rows[0];
  const client=(await db.query<{id:string}>("insert into public.clients(full_name,dni,phone,address) values('Cliente atrasado','87654321','999999998','Lima centro') returning id")).rows[0].id;
  const loan=(await db.query<{id:string}>(`select public.create_loan('${randomUUID()}','${client}',100000,600,1,'${start}') id`)).rows[0].id;
  const before=await db.query<{due_date:string}>(`select due_date::text from public.installment_balances where loan_id='${loan}' order by number`);
  await db.exec(`select public.record_payment('${randomUUID()}','${loan}',6000,'${today}')`);
  await assert.rejects(db.exec(`select public.refinance_loan('${randomUUID()}','${loan}')`));
  const overdue=(await db.query<{pending:number}>(`select sum(pending_cents)::int pending from public.installment_balances where loan_id='${loan}' and status='vencido'`)).rows[0].pending;
  assert.equal(overdue,47000);
  assert.deepEqual((await db.query(`select due_date::text from public.installment_balances where loan_id='${loan}' order by number`)).rows,before.rows);
  await db.exec(`set request.jwt.claim.sub='${admin}'`);
 } finally {await db.close();}
});

test('SQL respeta los tres productos y S/120 para dos meses; refinancia por un mes al 6 %',async()=>{
 const db=await financialDatabase();
 try{
  const today=(await db.query<{today:string}>("select ((now() at time zone 'America/Lima')::date)::text today")).rows[0].today;
  const client=(await db.query<{id:string}>("insert into public.clients(full_name,dni,phone,address) values('Dos meses','12345678','999999999','Lima centro') returning id")).rows[0].id;
  for(const args of ['50000,0,1','50000,600,1','50000,700,2','100000,700,1'])await assert.rejects(db.exec(`select public.create_loan('${randomUUID()}','${client}',${args},'${today}')`));
  assert.equal((await db.query('select * from public.loans')).rows.length,0);
  const loan=(await db.query<{id:string}>(`select public.create_loan('${randomUUID()}','${client}',100000,600,2,'${today}') id`)).rows[0].id;
  assert.equal((await db.query<{interest:number}>(`select interest_pending::int interest from public.loans where id='${loan}'`)).rows[0].interest,12000);
  const cuotas=await db.query<{scheduled_cents:number}>(`select scheduled_cents::int from public.installment_balances where loan_id='${loan}'`);
  assert.equal(cuotas.rows.length,8);assert.ok(cuotas.rows.every(i=>i.scheduled_cents===14000));
  await db.exec(`select public.record_payment('${randomUUID()}','${loan}',25000,'${today}')`);
  await db.exec(`select public.refinance_loan('${randomUUID()}','${loan}')`);
  const balances=(await db.query<{capital:number;interest:number}>(`select capital_pending::int capital,interest_pending::int interest from public.loans where id='${loan}'`)).rows[0];
  assert.deepEqual(balances,{capital:87000,interest:6000});
  const period=(await db.query<{months:number;opening_capital:number;interest_generated:number}>(`select months,opening_capital::int,interest_generated::int from public.loan_periods where loan_id='${loan}' and is_current`)).rows[0];
  assert.deepEqual(period,{months:1,opening_capital:87000,interest_generated:6000});
 }finally{await db.close();}
});
