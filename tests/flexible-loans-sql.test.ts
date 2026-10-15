import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { financialDatabase, admin, chief } from './helpers';

test('migración 006 actualiza montos y refinanciación a la vez, conservando datos, tasas y permisos', async () => {
 const db = await financialDatabase();
 try {
  const {today,start} = (await db.query<{today:string;start:string}>("select ((now() at time zone 'America/Lima')::date)::text today,((now() at time zone 'America/Lima')::date-29)::text start")).rows[0];
  let index = 0;
  const client = async () => (await db.query<{id:string}>(`insert into public.clients(full_name,dni,phone,address) values('Cliente flexible ${++index}','${80000000+index}','999999999','Lima centro') returning id`)).rows[0].id;
  const originalClient = await client();
  const originalLoan = (await db.query<{id:string}>(`select public.create_loan('${randomUUID()}','${originalClient}',50000,700,1,'${start}') id`)).rows[0].id;
  await db.exec(`select public.record_payment('${randomUUID()}','${originalLoan}',3500,'${today}')`);
  const previousLoans = (await db.query('select * from public.loans order by id')).rows;
  const previousPayments = (await db.query('select * from public.payments order by id')).rows;
  await assert.rejects(db.exec(`select public.refinance_loan('${randomUUID()}','${originalLoan}')`), /Cuotas vencidas pendientes/);
  await db.exec('reset role');
  const sql = await readFile(new URL('../supabase/migrations/202610150006_flexible_loans_and_refinancing.sql',import.meta.url), 'utf8');
  await db.exec(sql);
  await db.exec(sql);
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${admin}'`);
  assert.deepEqual((await db.query('select * from public.loans order by id')).rows,previousLoans);
  assert.deepEqual((await db.query('select * from public.payments order by id')).rows,previousPayments);
  const refinanceRequest = randomUUID();
  const refinancing = `select public.refinance_loan('${refinanceRequest}','${originalLoan}') id`;
  const period = (await db.query<{id:string}>(refinancing)).rows[0].id;
  assert.equal((await db.query<{id:string}>(refinancing)).rows[0].id,period);
  assert.deepEqual((await db.query(`select start_date::text start,months,interest_generated::int interest,opening_capital::int capital from public.loan_periods where id='${period}'`)).rows[0],{start:today,months:1,interest:3500,capital:50000});
  let flexibleLoan = '';
  for (const [capital,rate] of [[1,700],[25000,700],[49999,700],[50000,700],[50001,600],[100000,600],[150000,600],[200000,600]]) {
   for (const months of [1,2]) {
    const owner = await client();
    const request = randomUUID();
    const create = `select public.create_loan('${request}','${owner}',${capital},${rate},${months},'${today}') id`;
    const loan = (await db.query<{id:string}>(create)).rows[0].id;
    assert.equal((await db.query<{id:string}>(create)).rows[0].id,loan);
    const expectedInterest = Math.floor((capital*rate*months+5000)/10000);
    const quotas = (await db.query<{amount:number;days:number}>(`select i.scheduled_cents::int amount,(i.due_date-p.start_date)::int days from public.installments i join public.loan_periods p on p.id=i.period_id where p.loan_id='${loan}' order by i.number`)).rows;
    assert.equal(quotas.length,months*4);
    assert.equal(quotas.reduce((n,row)=>n+row.amount,0),capital+expectedInterest);
    assert.deepEqual(quotas.map(row=>row.days),Array.from({length:months*4},(_,i)=>(i+1)*7));
    assert.equal((await db.query<{interest:number}>(`select interest_pending::int interest from public.loans where id='${loan}'`)).rows[0].interest,expectedInterest);
    if(capital===150000 && months===2) {
     assert.ok(quotas.every(row=>row.amount===21000));
     flexibleLoan=loan;
    }
   }
  }
  const invalidClient = await client();
  for (const args of ['0,700,1','-1,700,1','25000,600,1','50000,600,1','50001,700,1','150000,700,2','150000,600,0','150000,600,3','9007199254740991,600,2']) {
   await assert.rejects(db.exec(`select public.create_loan('${randomUUID()}','${invalidClient}',${args},'${today}')`));
  }
  await db.exec(`set request.jwt.claim.sub='${chief}'`);
  assert.ok((await db.query('select * from public.loans')).rows.length>0);
  await assert.rejects(db.exec(`select public.create_loan('${randomUUID()}','${invalidClient}',150000,600,2,'${today}')`), /administrador/);
  await assert.rejects(db.exec(`select public.refinance_loan('${randomUUID()}','${originalLoan}')`), /administrador/);
  await db.exec(`set request.jwt.claim.sub='${admin}'`);
  await db.exec(`select public.record_payment('${randomUUID()}','${flexibleLoan}',21000,'${today}')`);
  assert.deepEqual((await db.query(`select capital_pending::int capital,interest_pending::int interest from public.loans where id='${flexibleLoan}'`)).rows[0],{capital:147000,interest:0});
  await assert.rejects(db.exec(`select public.refinance_loan('${randomUUID()}','${flexibleLoan}')`),/periodo aún no ha terminado/);
  await db.exec('reset role;set role anon');
  await assert.rejects(db.exec(`select public.create_loan('${randomUUID()}','${invalidClient}',150000,600,2,'${today}')`), /permission denied/);
 } finally { await db.close(); }
});
