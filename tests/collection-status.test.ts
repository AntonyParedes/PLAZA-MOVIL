import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectionStatus,weekdayLabel} from '../src/lib/collection-status';
import type {Loan,Period,Installment} from '../src/lib/portal';
const loan:Loan={id:'loan',client_id:'client',original_capital:100000,capital_pending:81000,interest_pending:6000,rate_basis_points:600,status:'activo',created_at:'2026-10-01T00:00:00Z'};
const original:Period={id:'old',loan_id:'loan',number:1,start_date:'2026-09-01',end_date:'2026-09-29',months:1,opening_capital:100000,interest_generated:6000,interest_settled_on:'2026-09-29',is_current:false};
const current:Period={...original,id:'new',number:2,start_date:'2026-09-29',end_date:'2026-10-27',opening_capital:81000,is_current:true};
const cuota:Installment={id:'quota',loan_id:'loan',period_id:'new',number:1,due_date:'2026-10-06',scheduled_cents:21750,paid_cents:0,pending_cents:21750,is_current:true,status:'pendiente'};
test('puntual hasta el día de vencimiento, atrasado de 1 a 6 y mora desde 7',()=>{
 assert.equal(collectionStatus(loan,[original,current],[cuota],'2026-10-06').state,'Puntual');
 for(let day=7;day<=12;day++){
  const status=collectionStatus(loan,[original,current],[cuota],`2026-10-${day.toString().padStart(2,'0')}`);
  assert.equal(status.state,'Atrasado');assert.equal(status.daysLate,day-6);
 }
 assert.equal(collectionStatus(loan,[original,current],[cuota],'2026-10-13').state,'En mora');
 assert.equal(collectionStatus(loan,[original,current],[cuota],'2026-10-13').daysLate,7);
});
test('saldo incluye interés, cuota programada no se confunde con resto parcial y fecha original permanece',()=>{
 const status=collectionStatus(loan,[original,current],[{...cuota,paid_cents:10000,pending_cents:11750}],'2026-10-09');
 assert.equal(status.balance,87000n);assert.equal(status.weeklyCents,21750);assert.equal(status.overdueCents,11750n);
 assert.equal(status.startDate,'2026-09-01');assert.equal(status.nextDate,'2026-10-06');assert.equal(status.refinanced,true);
 assert.equal(weekdayLabel(status.nextDate!),'martes');
});
test('cuotas históricas no causan mora y liquidación conserva marca de refinanciado',()=>{
 const historic={...cuota,id:'history',period_id:'old',due_date:'2026-09-08',is_current:false};
 const paid={...cuota,paid_cents:21750,pending_cents:0};
 const next={...cuota,id:'next',number:2,due_date:'2026-10-13'};
 const punctual=collectionStatus(loan,[original,current],[historic,paid,next],'2026-10-09');
 assert.equal(punctual.daysLate,0);assert.equal(punctual.state,'Puntual');assert.equal(punctual.nextDate,'2026-10-13');
 const settled=collectionStatus({...loan,status:'liquidado',capital_pending:0,interest_pending:0},[original,current],[historic,paid],'2026-11-01');
 assert.equal(settled.state,'Liquidado');assert.equal(settled.daysLate,0);assert.equal(settled.balance,0n);assert.equal(settled.weeklyCents,0);assert.equal(settled.nextDate,null);assert.equal(settled.refinanced,true);
});
