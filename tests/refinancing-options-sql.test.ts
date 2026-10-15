import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { financialDatabase, admin, chief } from './helpers';

test('007 admite fecha/plazo, mantiene API anterior e idempotencia y rechaza cambios no autorizados', async () => {
 const db=await financialDatabase();
 try {
  const dates=(await db.query<{today:string;start:string;chosen:string;earliest:string;paid:string;future:string}>(`select (now() at time zone 'America/Lima')::date::text today,((now() at time zone 'America/Lima')::date-40)::text start,((now() at time zone 'America/Lima')::date-3)::text chosen,((now() at time zone 'America/Lima')::date-11)::text earliest,((now() at time zone 'America/Lima')::date-20)::text paid,((now() at time zone 'America/Lima')::date+1)::text future`)).rows[0];
  let index=0;
  async function loan() {
   const owner=(await db.query<{id:string}>(`insert into public.clients(full_name,dni,phone,address) values('Refinanciación opciones ${++index}','${70000000+index}','999999999','Lima centro') returning id`)).rows[0].id;
   const id=(await db.query<{id:string}>(`select public.create_loan('${randomUUID()}','${owner}',100000,600,1,'${dates.start}') id`)).rows[0].id;
   await db.exec(`select public.record_payment('${randomUUID()}','${id}',25000,'${dates.paid}')`);
   return id;
  }
  const original=await loan();
  const previousPayments=(await db.query('select * from public.payments')).rows;
  const previousQuotas=(await db.query('select * from public.installments')).rows;
  await db.exec('reset role');
  const migration=await readFile(new URL('../supabase/migrations/202610150007_refinance_date_and_term.sql',import.meta.url),'utf8');
  await db.exec(migration);
  await db.exec(migration);
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${admin}'`);
  assert.deepEqual((await db.query('select * from public.payments')).rows,previousPayments);
  assert.deepEqual((await db.query('select * from public.installments')).rows,previousQuotas);
  for(const invalid of [`'${dates.start}',2`,`'${dates.future}',2`,`'${dates.chosen}',3`,`null,2`,`'${dates.chosen}',null`]) await assert.rejects(db.exec(`select public.refinance_loan('${randomUUID()}','${original}',${invalid})`));
  const request=randomUUID();
  const sql=`select public.refinance_loan('${request}','${original}','${dates.chosen}',2) id`;
  const period=(await db.query<{id:string}>(sql)).rows[0].id;
  assert.equal((await db.query<{id:string}>(sql)).rows[0].id,period);
  assert.equal((await db.query<{id:string}>(`select public.refinance_loan('${request}','${original}') id`)).rows[0].id,period);
  await assert.rejects(db.exec(`select public.refinance_loan('${request}','${original}','${dates.today}',2)`),/Solicitud reutilizada/);
  await assert.rejects(db.exec(`select public.refinance_loan('${request}','${original}','${dates.chosen}',1)`),/Solicitud reutilizada/);
  const current=(await db.query(`select start_date::text start,end_date-start_date days,months,opening_capital::int capital,interest_generated::int interest from public.loan_periods where id='${period}'`)).rows[0];
  assert.deepEqual(current,{start:dates.chosen,days:56,months:2,capital:81000,interest:12000});
  const quotas=(await db.query<{days:number;amount:number}>(`select (i.due_date-p.start_date)::int days,i.scheduled_cents::int amount from public.installments i join public.loan_periods p on p.id=i.period_id where p.id='${period}' order by i.number`)).rows;
  assert.deepEqual(quotas,Array.from({length:8},(_,i)=>({days:(i+1)*7,amount:11625})));
  assert.deepEqual((await db.query(`select capital_pending::int capital,interest_pending::int interest from public.loans where id='${original}'`)).rows[0],{capital:81000,interest:12000});
  const legacy=await loan();
  const legacyRequest=randomUUID();
  const legacyPeriod=(await db.query<{id:string}>(`select public.refinance_loan('${legacyRequest}','${legacy}') id`)).rows[0].id;
  assert.equal((await db.query<{id:string}>(`select public.refinance_loan('${legacyRequest}','${legacy}') id`)).rows[0].id,legacyPeriod);
  assert.deepEqual((await db.query(`select start_date::text start,months,interest_generated::int interest from public.loan_periods where id='${legacyPeriod}'`)).rows[0],{start:dates.earliest,months:1,interest:6000});
  await assert.rejects(db.exec(`select public.refinance_loan('${request}','${legacy}','${dates.chosen}',2)`),/Solicitud reutilizada/);
  await db.exec(`set request.jwt.claim.sub='${chief}'`);
  await assert.rejects(db.exec(`select public.refinance_loan('${randomUUID()}','${original}','${dates.today}',1)`),/administrador/);
  await assert.rejects(db.exec(`select public.refinance_loan('${randomUUID()}','${legacy}')`),/administrador/);
  await db.exec('reset role;set role anon');
  await assert.rejects(db.exec(`select public.refinance_loan('${randomUUID()}','${original}','${dates.today}',2)`),/permission denied/);
 }finally{await db.close();}
});
