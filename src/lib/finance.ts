/** All amounts are integer céntimos. Rates are integer basis points (600 = 6%). */
export function cents(value: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error('Monto inválido; usa hasta dos decimales.');
  const [whole, fraction = ''] = value.split('.');
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Monto fuera de rango.');
  return Number(amount);
}
function monetary(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Se requieren céntimos enteros no negativos.');
}
/** Monthly simple interest on original capital, rounded once at the end, half up. */
export function interest(originalCapital: number, monthlyRateBasisPoints: number, months: 1 | 2 = 1): number {
  monetary(originalCapital);
  monetary(monthlyRateBasisPoints);
  if (months !== 1 && months !== 2) throw new Error('Plazo inválido.');
  const numerator = BigInt(originalCapital) * BigInt(monthlyRateBasisPoints) * BigInt(months);
  const result = (numerator + 5000n) / 10000n;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Interés fuera de rango.');
  return Number(result);
}
export function applyPayment(payment: number, pendingInterest: number, pendingCapital: number) {
  [payment, pendingInterest, pendingCapital].forEach(monetary);
  if (payment === 0) throw new Error('El pago debe ser mayor que cero.');
  if (BigInt(payment) > BigInt(pendingInterest) + BigInt(pendingCapital)) throw new Error('El pago supera la deuda pendiente.');
  const interestPaid = Math.min(payment, pendingInterest);
  const capitalPaid = payment - interestPaid;
  return { interestPaid, capitalPaid, pendingInterest: pendingInterest - interestPaid, pendingCapital: pendingCapital - capitalPaid };
}
export function requireInterestSettled(pendingInterest: number) {
  monetary(pendingInterest);
  if (pendingInterest !== 0) throw new Error('No se puede refinanciar con intereses pendientes.');
  // This prerequisite alone does not authorize refinancing: date/rate conditions are pending.
}

export type ScheduledInstallment = {
  number: number;
  dueDate: string;
  scheduledCents: number;
};

/** Date-only contractual values: no UTC/local conversion or holiday adjustment. */
function contractualDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Fecha inválida; usa AAAA-MM-DD.');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('La fecha no existe.');
  }
  return date;
}

/** 1 month = 4 weeks; first payment 7 days after origination. */
export function scheduleLoan(originalCapital: number, monthlyRateBasisPoints: number, months: 1 | 2, startDate: string) {
  monetary(originalCapital);
  if (originalCapital === 0) throw new Error('El capital debe ser mayor que cero.');
  if (months !== 1 && months !== 2) throw new Error('El plazo debe ser de uno o dos meses.');
  const date = contractualDate(startDate);
  const interestCents = interest(originalCapital, monthlyRateBasisPoints, months);
  const total = BigInt(originalCapital) + BigInt(interestCents);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Deuda fuera de rango.');
  const count = months * 4;
  const base = total / BigInt(count);
  const remainder = Number(total % BigInt(count));
  const installments: ScheduledInstallment[] = [];
  for (let index = 0; index < count; index++) {
    date.setUTCDate(date.getUTCDate() + 7);
    const dueDate = date.toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error('Vencimiento fuera del rango de fechas.');
    installments.push({
      number: index + 1,
      dueDate,
      scheduledCents: Number(base) + (index >= count - remainder ? 1 : 0),
    });
  }
  return { originalCapital, interestCents, totalCents: Number(total), endDate: installments.at(-1)!.dueDate, installments };
}

/** Preview only: persisted balances, settlement date and overdue count must come from the database. */
export function scheduleRefinancing(input: {
  originalCapital: number;
  pendingCapital: number;
  pendingInterest: number;
  overdueUnpaidInstallments: number;
  existingRateBasisPoints: number;
  interestSettlementDate: string;
}) {
  monetary(input.originalCapital);
  requireApprovedProduct(input.originalCapital, input.existingRateBasisPoints, 1);
  monetary(input.pendingCapital);
  if (input.pendingCapital === 0 || input.pendingCapital > input.originalCapital) {
    throw new Error('El capital pendiente debe ser positivo y no superar el capital original.');
  }
  requireRefinancingPrerequisites(input.pendingInterest, input.overdueUnpaidInstallments);
  const originalPlan = scheduleLoan(input.originalCapital, input.existingRateBasisPoints, 1, input.interestSettlementDate);
  const total = BigInt(input.pendingCapital) + BigInt(originalPlan.interestCents);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Deuda fuera de rango.');
  const base = total / 4n;
  const remainder = Number(total % 4n);
  return {
    originalCapital: input.originalCapital,
    pendingCapital: input.pendingCapital,
    rateBasisPoints: input.existingRateBasisPoints,
    startDate: input.interestSettlementDate,
    endDate: originalPlan.endDate,
    interestCents: originalPlan.interestCents,
    totalCents: Number(total),
    installments: originalPlan.installments.map((row, index) => ({
      ...row, scheduledCents: Number(base) + (index >= 4 - remainder ? 1 : 0),
    })),
  };
}

export const loanProducts = [
  { id: '500-1', label: 'S/500 · 7 % mensual · 1 mes (4 cuotas)', capital: 50000, rate: 700, months: 1 },
  { id: '1000-1', label: 'S/1.000 · 6 % mensual · 1 mes (4 cuotas)', capital: 100000, rate: 600, months: 1 },
  { id: '1000-2', label: 'S/1.000 · 6 % mensual · 2 meses (8 cuotas)', capital: 100000, rate: 600, months: 2 },
  { id: '2000-2', label: 'S/2.000 · 6 % mensual · 2 meses (8 cuotas)', capital: 200000, rate: 600, months: 2 },
] as const;

export function requireApprovedProduct(capital: number, rate: number, months: number) {
  if (!loanProducts.some(product => product.capital === capital && product.rate === rate && product.months === months)) {
    throw new Error('Selecciona uno de los productos de préstamo autorizados.');
  }
}
export function decimalSoles(amount: number | bigint): string {
  if (typeof amount === 'number') monetary(amount);
  const value = BigInt(amount);
  if (value < 0n) throw new Error('Monto no negativo requerido.');
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}
export function formatPEN(amount: number | bigint) {
  const [whole, fraction] = decimalSoles(amount).split('.');
  return new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' })
    .formatToParts(BigInt(whole)).map(part => part.type === 'fraction' ? fraction : part.value).join('');
}

/** Necessary prerequisites; contract date/rate conditions must be approved separately. */
export function requireRefinancingPrerequisites(pendingInterest: number, overdueUnpaidInstallments: number) {
  requireInterestSettled(pendingInterest);
  monetary(overdueUnpaidInstallments);
  if (overdueUnpaidInstallments > 0) throw new Error('No se puede refinanciar con cuotas vencidas pendientes.');
}
