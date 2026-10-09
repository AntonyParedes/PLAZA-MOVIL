import { collectionStatus } from "./collection-status";
import { formatPEN } from "./finance";
import {
  dateLabel,
  type Customer,
  type Loan,
  type Period,
  type Payment,
  type Installment,
} from "./portal";
export type AccountData = {
  loans: Loan[];
  periods: Period[];
  payments: Payment[];
  installments: Installment[];
};
export function clientAccount(
  clientId: string,
  data: AccountData,
  today: string,
) {
  const loans = data.loans.filter((l) => l.client_id === clientId);
  const ids = new Set(loans.map((l) => l.id));
  const payments = data.payments.filter((p) => ids.has(p.loan_id));
  const entries = loans.map((loan) => ({
    loan,
    ...collectionStatus(loan, data.periods, data.installments, today),
  }));
  const daysLate = Math.max(0, ...entries.map((e) => e.daysLate));
  const state = !loans.length
    ? "Sin préstamos"
    : loans.every((l) => l.status === "liquidado")
      ? "Liquidado"
      : daysLate >= 7
        ? "En mora"
        : daysLate > 0
          ? "Atrasado"
          : "Puntual";
  return {
    entries,
    payments,
    state,
    daysLate,
    balance: entries.reduce((sum, e) => sum + e.balance, 0n),
    interestCollected: payments.reduce(
      (sum, p) => sum + BigInt(p.interest_cents),
      0n,
    ),
    capitalCollected: payments.reduce(
      (sum, p) => sum + BigInt(p.capital_cents),
      0n,
    ),
    totalCollected: payments.reduce(
      (sum, p) => sum + BigInt(p.amount_cents),
      0n,
    ),
  };
}
export function clientWhatsApp(
  client: Customer,
  data: AccountData,
  today: string,
) {
  const account = clientAccount(client.id, data, today);
  const lines = [
    `Hola ${client.full_name}, te contactamos de PM Créditos.`,
    "",
    `Estado: ${account.state === "Atrasado" ? `Se atrasó ${account.daysLate} días` : account.state}`,
    `Saldo total: ${formatPEN(account.balance)}`,
    `Días de atraso: ${account.daysLate}`,
  ];
  account.entries
    .filter((e) => e.loan.status === "activo")
    .forEach((e, index) => {
      const quota = data.installments
        .filter(
          (i) => i.loan_id === e.loan.id && i.is_current && i.pending_cents > 0,
        )
        .sort(
          (a, b) => a.due_date.localeCompare(b.due_date) || a.number - b.number,
        )[0];
      lines.push(
        "",
        `Préstamo ${index + 1}: ${e.state}. Saldo: ${formatPEN(e.balance)}.${e.refinanced ? " Refinanciado." : ""}`,
      );
      if (quota)
        lines.push(
          `Cuota pendiente: ${quota.number}`,
          `Vencimiento: ${dateLabel(quota.due_date)}`,
          `Saldo de la cuota: ${formatPEN(quota.pending_cents)}`,
          `Días de atraso de la cuota: ${e.daysLate}`,
        );
    });
  if (account.entries.some((e) => e.loan.status === "activo"))
    lines.push(
      "",
      account.daysLate > 0
        ? "Te solicitamos regularizar el pago pendiente. El atraso puede generar penalidades según las condiciones de tu préstamo."
        : "Recuerda pagar en la fecha acordada. El atraso puede generar penalidades según las condiciones de tu préstamo.",
    );
  else if (account.state === "Liquidado")
    lines.push(
      "",
      "Tu préstamo ha sido liquidado en su totalidad. Gracias por tus pagos.",
    );
  lines.push("", "Atentamente,", "La Gerencia", "PM Créditos");
  return lines.join("\n");
}
