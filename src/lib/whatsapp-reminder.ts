import { formatPEN } from "./finance";
import {
  dateLabel,
  type Customer,
  type Installment,
  type Loan,
  type Period,
} from "./portal";
import { collectionStatus } from "./collection-status";

/** Prepares text only. Sending stays under the operator's control in WhatsApp. */
export function whatsappReminder(
  client: Customer,
  loan: Loan,
  installment: Installment,
  periods: Period[],
  installments: Installment[],
  today: string,
) {
  const daysLate =
    installment.pending_cents > 0
      ? Math.max(
          0,
          Math.floor(
            (Date.parse(`${today}T00:00:00Z`) -
              Date.parse(`${installment.due_date}T00:00:00Z`)) /
              86400000,
          ),
        )
      : 0;
  const state =
    installment.pending_cents === 0
      ? "Pagada"
      : daysLate >= 7
        ? "En mora"
        : daysLate > 0
          ? "Atrasada"
          : "Pendiente";
  const loanState = collectionStatus(loan, periods, installments, today);
  const lines = [
    `Hola ${client.full_name}, te contactamos de PM Créditos.`,
    "",
    `Cuota: ${installment.number}`,
    `Fecha de vencimiento: ${dateLabel(installment.due_date)}`,
    `Saldo de esta cuota: ${formatPEN(installment.pending_cents)}`,
    `Estado de la cuota: ${state}${installment.pending_cents > 0 && installment.paid_cents > 0 ? " (pago parcial)" : ""}`,
    `Días de atraso de esta cuota: ${daysLate} ${daysLate === 1 ? "día" : "días"}`,
  ];
  if (loanState.daysLate > daysLate) {
    lines.push(
      `Estado del préstamo: ${loanState.state === "Atrasado" ? "Atrasado" : loanState.state}. La cuota pendiente más antigua tiene ${loanState.daysLate} días de atraso.`,
    );
  }
  if (daysLate > 0 || loanState.daysLate > 0) {
    lines.push(
      "",
      "Te solicitamos regularizar el pago pendiente. El atraso puede generar penalidades según las condiciones de tu préstamo.",
    );
  } else {
    lines.push(
      "",
      installment.due_date === today
        ? "Tu cuota vence hoy. Te recordamos realizar el pago en la fecha acordada."
        : "Te recordamos realizar el pago en la fecha acordada.",
    );
  }
  lines.push("", "Atentamente,", "La Gerencia", "PM Créditos");
  return lines.join("\n");
}
