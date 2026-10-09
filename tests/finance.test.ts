import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cents, interest, applyPayment, requireInterestSettled, scheduleLoan, scheduleRefinancing, requireApprovedProduct } from '../src/lib/finance';

test('interés explícito sobre capital original', () => {
  assert.equal(interest(100000, 600), 6000);
  assert.equal(interest(100000, 600), 6000); // original stays 100000 after amortization
});
test('ejemplo: S/250 paga S/60 de interés y S/190 de capital', () => {
  assert.deepEqual(applyPayment(25000, 6000, 100000), {
    interestPaid: 6000, capitalPaid: 19000, pendingInterest: 0, pendingCapital: 81000,
  });
});
test('pago parcial conserva interés y capital restantes', () => {
  assert.deepEqual(applyPayment(2000, 6000, 100000), {
    interestPaid: 2000, capitalPaid: 0, pendingInterest: 4000, pendingCapital: 100000,
  });
});
test('adelanto liquida toda la deuda sin descontar interés', () => {
  assert.deepEqual(applyPayment(106000, 6000, 100000), {
    interestPaid: 6000, capitalPaid: 100000, pendingInterest: 0, pendingCapital: 0,
  });
});
test('interés pendiente impide cumplir requisito de refinanciación', () => {
  assert.throws(() => requireInterestSettled(1));
  assert.doesNotThrow(() => requireInterestSettled(0));
});
test('decimales en céntimos sin aritmética binaria', () => {
  assert.equal(cents('1000.01'), 100001);
  assert.equal(cents('0.1'), 10);
  assert.equal(interest(cents('12.50'), 800), 100);
  assert.throws(() => cents('1.001'));
  assert.equal(interest(1, 600), 0);
});

test('redondea interés al céntimo más cercano; mitades hacia arriba', () => {
  assert.equal(interest(1, 4999), 0);
  assert.equal(interest(1, 5000), 1);
  assert.equal(interest(1, 5001), 1);
  assert.equal(interest(101, 5000), 51);
  assert.throws(() => interest(Number.MAX_SAFE_INTEGER, 10001));
});

test('un mes: cuatro cuotas semanales, primera a siete días', () => {
  const plan = scheduleLoan(100000, 600, 1, '2026-10-09');
  assert.equal(plan.interestCents, 6000);
  assert.equal(plan.totalCents, 106000);
  assert.equal(plan.endDate, '2026-11-06');
  assert.deepEqual(plan.installments, [
    { number: 1, dueDate: '2026-10-16', scheduledCents: 26500 },
    { number: 2, dueDate: '2026-10-23', scheduledCents: 26500 },
    { number: 3, dueDate: '2026-10-30', scheduledCents: 26500 },
    { number: 4, dueDate: '2026-11-06', scheduledCents: 26500 },
  ]);
});

test('dos meses: ocho cuotas; 6 % mensual genera S/120 de interés', () => {
  const plan = scheduleLoan(100000, 600, 2, '2026-10-09');
  assert.equal(plan.interestCents, 12000);
  assert.equal(plan.totalCents, 112000);
  assert.equal(plan.installments.length, 8);
  assert.equal(plan.endDate, '2026-12-04');
  assert.ok(plan.installments.every(row => row.scheduledCents === 14000));
});

test('distribuye céntimos sobrantes en las últimas cuotas preservando el total', () => {
  const plan = scheduleLoan(100003, 0, 1, '2026-01-01');
  assert.deepEqual(plan.installments.map(row => row.scheduledCents), [25000, 25001, 25001, 25001]);
  assert.equal(plan.installments.reduce((total, row) => total + row.scheduledCents, 0), plan.totalCents);
  for (let remainder = 0; remainder < 8; remainder++) {
    const plan = scheduleLoan(100000 + remainder, 0, 2, '2026-01-01');
    assert.equal(plan.installments.reduce((sum, row) => sum + row.scheduledCents, 0), plan.totalCents);
    assert.equal(plan.installments.filter(row => row.scheduledCents === 12501).length, remainder);
  }
});

test('mantiene fechas semanales en feriados, cambios de año y año bisiesto', () => {
  assert.equal(scheduleLoan(10000, 0, 1, '2026-12-18').installments[0].dueDate, '2026-12-25');
  assert.equal(scheduleLoan(10000, 0, 1, '2026-12-18').installments[1].dueDate, '2027-01-01');
  assert.equal(scheduleLoan(10000, 0, 1, '2024-02-22').installments[0].dueDate, '2024-02-29');
});

test('rechaza fechas inexistentes, plazos inválidos y deuda no segura', () => {
  assert.throws(() => scheduleLoan(100, 0, 1, '2026-02-29'));
  assert.throws(() => scheduleLoan(100, 0, 1, '2026-2-01'));
  assert.throws(() => scheduleLoan(100, 0, 3 as 1, '2026-01-01'));
  assert.throws(() => scheduleLoan(0, 0, 1, '2026-01-01'));
  assert.throws(() => scheduleLoan(Number.MAX_SAFE_INTEGER, 10000, 1, '2026-01-01'));
  assert.throws(() => scheduleLoan(100, 0, 2, '9999-12-01'));
});

test('refinancia capital pendiente con tasa existente sobre capital original desde pago del interés', () => {
  const plan = scheduleRefinancing({ originalCapital: 100000, pendingCapital: 81000, pendingInterest: 0,
    overdueUnpaidInstallments: 0, existingRateBasisPoints: 600, interestSettlementDate: '2026-10-15' });
  assert.equal(plan.interestCents, 6000);
  assert.equal(plan.totalCents, 87000);
  assert.equal(plan.startDate, '2026-10-15');
  assert.equal(plan.endDate, '2026-11-12');
  assert.equal(plan.installments[0].dueDate, '2026-10-22');
  assert.ok(plan.installments.every(row => row.scheduledCents === 21750));
});

test('no refinancia deuda liquidada, intereses pendientes ni cuotas vencidas', () => {
  const input = { originalCapital: 100000, pendingCapital: 81000, pendingInterest: 0,
    overdueUnpaidInstallments: 0, existingRateBasisPoints: 600, interestSettlementDate: '2026-10-15' };
  assert.throws(() => scheduleRefinancing({ ...input, pendingCapital: 0 }));
  assert.throws(() => scheduleRefinancing({ ...input, pendingCapital: 100001 }));
  assert.throws(() => scheduleRefinancing({ ...input, pendingInterest: 1 }));
  assert.throws(() => scheduleRefinancing({ ...input, overdueUnpaidInstallments: 1 }));
  assert.throws(() => scheduleRefinancing({ ...input, interestSettlementDate: '2026-02-30' }));
});
test('rechaza sobrepago, cero, negativos y valores no seguros', () => {
  assert.throws(() => applyPayment(101, 0, 100));
  assert.throws(() => applyPayment(0, 10, 100));
  assert.throws(() => applyPayment(-1, 10, 100));
  assert.throws(() => applyPayment(0.1, 10, 100));
  assert.throws(() => cents('999999999999999999999'));
});

test('cuotas vencidas pendientes bloquean refinanciación aun con interés pagado', async () => {
  const { requireRefinancingPrerequisites } = await import('../src/lib/finance');
  assert.throws(() => requireRefinancingPrerequisites(0, 1));
  assert.throws(() => requireRefinancingPrerequisites(1, 0));
  assert.doesNotThrow(() => requireRefinancingPrerequisites(0, 0));
});

test('rechaza productos distintos de los autorizados, incluyendo interés de cero',()=>{
 assert.throws(()=>requireApprovedProduct(50000,0,1));
 assert.throws(()=>requireApprovedProduct(50000,600,1));
 assert.throws(()=>requireApprovedProduct(50000,700,2));
 assert.doesNotThrow(()=>requireApprovedProduct(50000,700,1));
 assert.doesNotThrow(()=>requireApprovedProduct(100000,600,1));
 assert.doesNotThrow(()=>requireApprovedProduct(100000,600,2));
});

test('productos aprobados: S/35, S/60 y S/120 de interés',()=>{
 assert.equal(scheduleLoan(50000,700,1,'2026-10-09').interestCents,3500);
 assert.equal(scheduleLoan(100000,600,1,'2026-10-09').interestCents,6000);
 assert.equal(scheduleLoan(100000,600,2,'2026-10-09').interestCents,12000);
 assert.ok(scheduleLoan(50000,700,1,'2026-10-09').installments.every(i=>i.scheduledCents===13375));
 assert.ok(scheduleLoan(100000,600,2,'2026-10-09').installments.every(i=>i.scheduledCents===14000));
});

test('presenta y exporta importes grandes sin perder céntimos',async()=>{
 const {formatPEN,decimalSoles}=await import('../src/lib/finance');
 assert.equal(decimalSoles(9007199254740991),'90071992547409.91');
 assert.equal(decimalSoles(18014398509481982n),'180143985094819.82');
 assert.ok(formatPEN(18014398509481982n).endsWith('.82'));
 assert.equal(decimalSoles(1),'0.01');
});
