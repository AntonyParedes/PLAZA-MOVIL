/* SQL results deliberately include heterogeneous JSON snapshots. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {financialDatabase,admin,chief,outsider} from './helpers';

async function setup(){
 const db=await financialDatabase();await db.exec('reset role');
 for(const name of ['202610090003_client_stand.sql','202610150007_refinance_date_and_term.sql','202610190008_delete_client.sql','202610270009_cash.sql','202611030010_settlement_penalty.sql','202611040011_payment_corrections.sql'])await db.exec(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));
 await db.exec(`set role authenticated;set request.jwt.claim.sub='${admin}'`);
 const dates=(await db.query<{today:string;start:string;refi:string}>("select ((now() at time zone 'America/Lima')::date)::text today,((now() at time zone 'America/Lima')::date-65)::text start,((now() at time zone 'America/Lima')::date-36)::text refi")).rows[0];
 const client=(await db.query<{id:string}>("insert into clients(full_name,dni,phone,address,stand_code,member_type) values('Cliente corregible','12345678','999999999','Lima prueba','COR-01','socio') returning id")).rows[0].id;
 const loan=(await db.query<{id:string}>('select create_loan($1,$2,100000,600,1,$3) id',[randomUUID(),client,dates.start])).rows[0].id;
 const pay=async(amount:number,paid=dates.start)=>(await db.query<{id:string}>('select record_payment($1,$2,$3,$4) id',[randomUUID(),loan,amount,paid])).rows[0].id;
 const preview=async(id:string,action='anular',amount:number|null=null,paid:string|null=null,reason='Pago duplicado')=>(await db.query<{p:Record<string,any>}>('select preview_payment_correction($1,$2,$3,$4,$5) p',[id,action,amount,paid,reason])).rows[0].p;
 const confirm=async(p:Record<string,any>,request=randomUUID())=>(await db.query<{id:string}>('select correct_payment($1,$2,$3,$4,$5,$6,$7) id',[request,p.payment_id,p.action,p.new_amount,p.new_paid_on,p.reason,p.confirmation_token])).rows[0].id;
 return {db,dates,client,loan,pay,preview,confirm};
}

test('anula un duplicado anterior a una refinanciación, reconstruye saldos y conserva el original sin duplicar capital',async()=>{
 const {db,dates,loan,pay,preview,confirm}=await setup();try{
  await db.exec(`select record_cash_movement('${randomUUID()}','apertura',500000,'Dinero inicial')`);
  await pay(26500);const duplicated=await pay(26500);
  await db.exec(`select refinance_loan('${randomUUID()}','${loan}','${dates.refi}',1)`);
  await pay(20000,dates.today);
  const before=(await db.query<any>('select * from loans where id=$1',[loan])).rows[0];assert.equal(before.capital_pending,39000);
  const p=await preview(duplicated);assert.equal(p.balance_before_cents,'39000');assert.equal(p.balance_after_cents,'65500');assert.equal(p.cash_delta_cents,'-26500');assert.equal(p.periods_count,2);
  assert.equal((await db.query('select * from payment_corrections')).rows.length,0,'Preview never writes');
  const request=randomUUID(),id=await confirm(p,request);assert.equal(await confirm(p,request),id);
  const after=(await db.query<any>('select * from loans where id=$1',[loan])).rows[0];assert.equal(after.capital_pending,65500);assert.equal(after.interest_pending,0);
  const periods=(await db.query<any>('select * from loan_periods where loan_id=$1 order by number',[loan])).rows;
  assert.equal(periods[1].opening_capital,79500);assert.equal(periods[1].interest_generated,6000);
  const totals=(await db.query<any>('select sum(scheduled_cents)::text total from installments where period_id=$1',[periods[1].id])).rows[0];assert.equal(totals.total,'85500');
  assert.equal((await db.query('select * from payments where id=$1',[duplicated])).rows.length,0);
  const audit=(await db.query<any>('select * from payment_corrections where id=$1',[id])).rows[0];assert.equal(audit.before_payment.amount_cents,26500);assert.equal(audit.after_payment,null);assert.equal(audit.actor_id,admin);
  const s=(await db.query<any>('select cash_summary() s')).rows[0].s;assert.equal(s.received_cents,'46500');assert.equal(s.interest_cents,'12000');assert.equal(s.balance_cents,'446500');
  await assert.rejects(db.query('select record_payment($1,$2,26500,$3)',[audit.original_request_id,loan,dates.today]),/fue anulado/);
  const balance=(await db.query<any>('select sum(pending_cents)::text balance from installment_balances where loan_id=$1 and is_current',[loan])).rows[0].balance;assert.equal(balance,'65500');
 }finally{await db.close();}
});

test('corrige monto y fecha, vuelve a repartir interés primero y bloquea revisiones antiguas o sobrepagos',async()=>{
 const {db,loan,dates,pay,preview,confirm}=await setup();try{
  const first=await pay(10000);await pay(10000);
  const p=await preview(first,'corregir',3000,dates.today,'Monto registrado por error');assert.equal(p.cash_delta_cents,'-7000');assert.equal(p.balance_after_cents,'93000');
  await confirm(p);
  const receipts=(await db.query<any>('select * from payments where loan_id=$1 order by recorded_order',[loan])).rows;
  assert.equal(receipts[0].interest_cents,3000);assert.equal(receipts[0].capital_cents,0);assert.equal(new Date(receipts[0].paid_on).toISOString().slice(0,10),dates.today);assert.equal(receipts[1].interest_cents,3000);assert.equal(receipts[1].capital_cents,7000);
  const stale=await preview(first,'corregir',4000,dates.today,'Ajuste adicional');await pay(1000);
  await assert.rejects(confirm(stale),/datos cambiaron/);
  await assert.rejects(preview(first,'corregir',106000,dates.today),/otro pago superior/);
  assert.equal((await db.query('select * from payment_corrections')).rows.length,1);
 }finally{await db.close();}
});

test('una liquidación con penalidad puede anularse completa y reabrir la deuda; no permite dos préstamos activos',async()=>{
 const {db,dates,loan,client,preview,confirm}=await setup();try{
  const id=(await db.query<{id:string}>('select settle_loan_with_penalty($1,$2,106000,5000,$3,$4) id',[randomUUID(),loan,'Plazo vencido',dates.today])).rows[0].id;
  const p=await preview(id);assert.equal(p.cash_delta_cents,'-111000');assert.equal(p.interest_delta_cents,'-6000');assert.equal(p.penalty_delta_cents,'-5000');assert.equal(p.status_after,'activo');
  await confirm(p);assert.equal((await db.query<any>('select status from loans where id=$1',[loan])).rows[0].status,'activo');
  const settlement=(await db.query<{id:string}>('select record_payment($1,$2,106000,$3) id',[randomUUID(),loan,dates.today])).rows[0].id;
  await db.query('select create_loan($1,$2,50000,700,1,$3)',[randomUUID(),client,dates.today]);
  await assert.rejects(preview(settlement),/otro activo/);
 }finally{await db.close();}
});

test('correcciones respetan RLS, roles, motivo, idempotencia y reglas de refinanciación',async()=>{
 const {db,loan,dates,pay,preview,confirm}=await setup();try{
  const receipt=await pay(6000);await db.query('select refinance_loan($1,$2,$3,1)',[randomUUID(),loan,dates.refi]);
  await assert.rejects(preview(receipt),/intereses pendientes antes de una refinanciación/);
  const current=await pay(1000,dates.today);const p=await preview(current);const request=randomUUID();await confirm(p,request);
  await assert.rejects(confirm({...p,reason:'Otro motivo'},request),/reutilizada/);
  for(const identity of [chief,outsider,'']){
   await db.exec(`set request.jwt.claim.sub='${identity}'`);
   assert.equal((await db.query('select * from payment_corrections')).rows.length,0);
   await assert.rejects(preview(receipt),/exclusiva del administrador/);await assert.rejects(confirm(p),/exclusiva del administrador/);
   await assert.rejects(db.exec('delete from payment_corrections'),/permission denied/);
  }
  await db.exec(`set request.jwt.claim.sub='${admin}'`);
  assert.equal((await db.query('select * from payment_corrections')).rows.length,1);
  await assert.rejects(preview(receipt,'corregir',6000,dates.start,''),/motivo/);
 }finally{await db.close();}
});

test('fallo al aplicar cuotas revierte archivo, pagos, periodos y saldos juntos; migración repetible',async()=>{
 const {db,pay,preview,confirm}=await setup();try{
  const id=await pay(26500);const p=await preview(id,'corregir',26000,null,'Corregir monto').catch(()=>null);
  assert.equal(p,null,'La fecha es obligatoria al corregir');
  const date=(await db.query<any>('select paid_on::text date from payments where id=$1',[id])).rows[0].date;
  const valid=await preview(id,'corregir',26000,date,'Corregir monto');
  const before=(await db.query<any>('select to_jsonb(p) data from payments p where id=$1',[id])).rows[0].data;
  await db.exec('reset role');
  await db.exec(await readFile(new URL('../supabase/migrations/202611040011_payment_corrections.sql',import.meta.url),'utf8'));
  await db.exec(`create function public.fail_correction_test() returns trigger language plpgsql as $$ begin raise exception 'Fallo simulado en cuotas'; end; $$;create trigger fail_correction_test before insert on payment_installments for each row execute function public.fail_correction_test();set role authenticated;set request.jwt.claim.sub='${admin}'`);
  await assert.rejects(confirm(valid),/Fallo simulado/);
  assert.deepEqual((await db.query<any>('select to_jsonb(p) data from payments p where id=$1',[id])).rows[0].data,before);
  assert.equal((await db.query('select * from payment_corrections')).rows.length,0);
  assert.equal((await db.query<any>('select sum(amount_cents)::text amount from payment_installments')).rows[0].amount,'26500');
  await assert.rejects(db.exec("select nextval(pg_get_serial_sequence('payments','recorded_order'))"),/permission denied/);
 }finally{await db.close();}
});
