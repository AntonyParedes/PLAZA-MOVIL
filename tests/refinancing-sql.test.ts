import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { financialDatabase, admin, chief } from './helpers';

const migration = new URL('../supabase/migrations/202610140005_refinance_after_period.sql', import.meta.url);

test('migración 005 permite refinanciar vencidos con interés pagado sin alterar históricos ni permisos', async () => {
 const db = await financialDatabase();
 try {
  const {today, start, paidOn, newStart} = (await db.query<{today:string;start:string;paidOn:string;newStart:string}>(`select ((now() at time zone 'America/Lima')::date)::text today, ((now() at time zone 'America/Lima')::date-32)::text start, ((now() at time zone 'America/Lima')::date-25)::text "paidOn", ((now() at time zone 'America/Lima')::date-3)::text "newStart"`)).rows[0];
  const client = (await db.query<{id:string}>("insert into public.clients(full_name,dni,phone,address) values('Cliente refinanciación','90000001','999999999','Lima centro') returning id")).rows[0].id;
  const loan = (await db.query<{id:string}>(`select public.create_loan('${randomUUID()}','${client}',100000,600,1,'${start}') id`)).rows[0].id;
  await db.exec(`select public.record_payment('${randomUUID()}','${loan}',25000,'${paidOn}')`);
  await assert.rejects(db.exec(`select public.refinance_loan('${randomUUID()}','${loan}')`), /Cuotas vencidas pendientes/);
  const rows = (await db.query<{id:string}>(`select * from public.loan_periods where loan_id='${loan}'`)).rows;
  const quotas = (await db.query<Record<string,unknown>>(`select * from public.installment_balances where loan_id='${loan}' order by number`)).rows;
  const payments = (await db.query(`select * from public.payments where loan_id='${loan}'`)).rows;
  await db.exec('reset role');
  await db.exec(await readFile(migration, 'utf8'));
  // The additive migration can be reapplied without touching operations.
  await db.exec(await readFile(migration, 'utf8'));
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${admin}'`);
  assert.deepEqual((await db.query(`select * from public.loan_periods where loan_id='${loan}'`)).rows, rows);
  await db.exec(`set request.jwt.claim.sub='${chief}'`);
  await assert.rejects(db.exec(`select public.refinance_loan('${randomUUID()}','${loan}')`), /Operación exclusiva del administrador/);
  await db.exec(`set request.jwt.claim.sub='${admin}'`);
  const request = randomUUID();
  const sql = `select public.refinance_loan('${request}','${loan}') id`;
  const period = (await db.query<{id:string}>(sql)).rows[0].id;
  assert.equal((await db.query<{id:string}>(sql)).rows[0].id, period);
  assert.deepEqual((await db.query(`select * from public.payments where loan_id='${loan}'`)).rows, payments);
  const oldQuotas = (await db.query<Record<string,unknown>>(`select * from public.installment_balances where period_id='${rows[0].id}' order by number`)).rows;
  const historicalFields = (row: Record<string,unknown>) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'is_current'));
  assert.deepEqual(oldQuotas.map(historicalFields), quotas.map(historicalFields));
  assert.ok(oldQuotas.every(row => row.is_current === false));
  const newQuotas = (await db.query<{scheduled:number;days:number}>(`select i.scheduled_cents::int scheduled,(i.due_date-p.start_date)::int days from public.installments i join public.loan_periods p on p.id=i.period_id where p.id='${period}' order by i.number`)).rows;
  assert.deepEqual(newQuotas, [7,14,21,28].map(days => ({scheduled:21750,days})));
  const newPeriod = (await db.query(`select start_date::text start, end_date-start_date days, months, opening_capital::int capital, interest_generated::int interest from public.loan_periods where id='${period}'`)).rows[0];
  assert.deepEqual(newPeriod, {start:newStart, days:28, months:1, capital:81000, interest:6000});
  assert.deepEqual((await db.query(`select capital_pending::int capital,interest_pending::int interest from public.loans where id='${loan}'`)).rows[0], {capital:81000,interest:6000});
  assert.equal((await db.query(`select * from public.audit_events where action='loans.refinance' and entity_id='${period}'`)).rows.length,1);
  await assert.rejects(db.exec(`select public.refinance_loan('${randomUUID()}','${loan}')`), /Intereses pendientes/);
  await db.exec(`select public.record_payment('${randomUUID()}','${loan}',6000,'${today}')`);
  await assert.rejects(db.exec(`select public.refinance_loan('${randomUUID()}','${loan}')`), /periodo aún no ha terminado/);
  await db.exec('reset role;set role anon');
  await assert.rejects(db.exec(`select public.refinance_loan('${randomUUID()}','${loan}')`), /permission denied/);
 } finally { await db.close(); }
});

test('migración 005 bloquea plazo vigente, día final e interés parcial; habilita cuatro u ocho cuotas vencidas', async () => {
 const db = await financialDatabase();
 try {
  await db.exec('reset role');
  for (const name of ['202610090003_client_stand.sql','202610100004_loan_2000.sql','202610140005_refinance_after_period.sql'])
   await db.exec(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url), 'utf8'));
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${admin}'`);
  let index = 0;
  async function create(capital:number,rate:number,months:number,days:number,payment:number) {
   index++;
   const client = (await db.query<{id:string}>(`insert into public.clients(full_name,dni,phone,address,stand_code,member_type) values('Cliente condición ${index}','${90000010+index}','999999999','Lima centro','S-${index}','socio') returning id`)).rows[0].id;
   const {today,start} = (await db.query<{today:string;start:string}>(`select ((now() at time zone 'America/Lima')::date)::text today, ((now() at time zone 'America/Lima')::date-${days})::text start`)).rows[0];
   const loan = (await db.query<{id:string}>(`select public.create_loan('${randomUUID()}','${client}',${capital},${rate},${months},'${start}') id`)).rows[0].id;
   await db.exec(`select public.record_payment('${randomUUID()}','${loan}',${payment},'${today}')`);
   return loan;
  }
  for (const days of [27,28]) {
   const loan = await create(100000,600,1,days,6000);
   await assert.rejects(db.exec(`select public.refinance_loan('${randomUUID()}','${loan}')`), /periodo aún no ha terminado/);
  }
  const partial = await create(100000,600,1,29,5999);
  await assert.rejects(db.exec(`select public.refinance_loan('${randomUUID()}','${partial}')`), /Intereses pendientes/);
  for (const [capital,rate,months,payment] of [[50000,700,1,3500],[100000,600,1,6000],[100000,600,2,12000],[200000,600,2,24000]]) {
   const loan = await create(capital,rate,months,months*28+1,payment);
   const period = (await db.query<{id:string}>(`select public.refinance_loan('${randomUUID()}','${loan}') id`)).rows[0].id;
   const state = (await db.query(`select opening_capital::int capital,interest_generated::int interest,months from public.loan_periods where id='${period}'`)).rows[0];
   assert.deepEqual(state, {capital,interest:capital*rate/10000,months:1});
  }
 } finally { await db.close(); }
});
