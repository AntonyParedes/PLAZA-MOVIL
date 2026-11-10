import test from 'node:test';
import assert from 'node:assert/strict';
import {financialOverview,chartPercent} from '../src/lib/financial-overview';
import type {Loan,Payment} from '../src/lib/portal';
const loan:Loan={id:'l',client_id:'c',original_capital:100000,capital_pending:76000,interest_pending:0,rate_basis_points:600,status:'activo',created_at:'2026-01-01T00:00:00Z'};
const payment:Payment={id:'p',loan_id:'l',period_id:'initial',amount_cents:36000,interest_cents:12000,capital_cents:24000,penalty_cents:5000,paid_on:'2026-01-31',created_at:'2026-02-01T02:00:00Z'};
test('historial agrupa por fecha de pago y separa interés, capital y penalidades, incluso tras liquidar o refinanciar',()=>{
 const result=financialOverview([loan,{...loan,id:'closed',capital_pending:0,status:'liquidado'}],[payment,{...payment,id:'later',period_id:'refinanced',paid_on:'2026-03-02',interest_cents:6000,capital_cents:10000,penalty_cents:0},{...payment,id:'same-month',paid_on:'2026-01-15',interest_cents:1000,capital_cents:0,penalty_cents:0}]);
 assert.equal(result.capitalPending,76000n);
 assert.deepEqual(result.months,[{month:'2026-01',interest:13000n,capital:24000n,penalty:5000n},{month:'2026-03',interest:6000n,capital:10000n,penalty:0n}]);
});
test('historial vacío y escalas negativas o grandes no inventan cifras ni pierden céntimos originales',()=>{
 assert.deepEqual(financialOverview([],[]),{capitalPending:0n,months:[]});
 assert.equal(chartPercent(0n,0n),0);assert.equal(chartPercent(-50n,100n),50);
 const big=900719925474099100n;assert.equal(chartPercent(big,big),100);
});

test('capital recuperado cuenta una sola vez el original y excluye interés y penalidades',async()=>{
 const {capitalRecovery}=await import('../src/lib/financial-overview');
 assert.deepEqual(capitalRecovery([loan],[payment]),{disbursed:100000n,pending:76000n,returned:24000n,reconciled:true});
 const final={...payment,id:'last',period_id:'refinance',amount_cents:82000,capital_cents:76000,interest_cents:6000,penalty_cents:5000};
 assert.deepEqual(capitalRecovery([{...loan,capital_pending:0,status:'liquidado'}],[payment,final]),{disbursed:100000n,pending:0n,returned:100000n,reconciled:true});
 assert.equal(capitalRecovery([loan],[]).reconciled,false);
 assert.equal(capitalRecovery([],[]).reconciled,false);
});
test('línea mensual incluye ceros en meses sin pagos y acumula desde el primer cobro',async()=>{
 const {interestTimeline}=await import('../src/lib/financial-overview');
 const grouped=financialOverview([loan],[payment,{...payment,paid_on:'2026-03-01',interest_cents:6000}]).months;
 const rows=interestTimeline(grouped,'2026-04-04');
 assert.deepEqual(rows.map(r=>[r.month,r.interest,r.accumulated]),[['2026-01',12000n,12000n],['2026-02',0n,12000n],['2026-03',6000n,18000n],['2026-04',0n,18000n]]);
 assert.deepEqual(interestTimeline([],'2026-04-04'),[]);
 assert.deepEqual(interestTimeline(financialOverview([],[{...payment,paid_on:'2025-12-31'}]).months,'2026-01-02').map(r=>r.month),['2025-12','2026-01']);
});
