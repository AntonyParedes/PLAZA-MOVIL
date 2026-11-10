"use client";
import { useState, type FormEvent } from "react";
import { cents, earlySettlementQuote, formatPEN } from "@/lib/finance";
import { limaDate, type Loan, type Period } from "@/lib/portal";
import { Button } from "@/components/ui/button";

export function EarlySettlement({ loan, period, today, busy, onConfirm }: {
  loan: Loan;
  period: Period;
  today: string;
  busy: boolean;
  onConfirm: (args: Record<string, string | number>, confirmation: string) => Promise<void>;
}) {
  const [discount, setDiscount] = useState("");
  const [paidOn, setPaidOn] = useState(limaDate);
  let quote: ReturnType<typeof earlySettlementQuote> | undefined;
  let error = "";
  try {
    if (discount) {
      quote = earlySettlementQuote(loan.capital_pending, loan.interest_pending, cents(discount));
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "Descuento inválido.";
  }
  const validDate = paidOn >= period.start_date && paidOn < period.end_date && paidOn <= today;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!quote || !validDate) return;
    await onConfirm(
      { p_loan: loan.id, p_amount: quote.totalCents, p_discount: cents(discount), p_paid_on: paidOn },
      `¿Cancelar anticipadamente el préstamo cobrando ${formatPEN(quote.totalCents)} y descontando ${formatPEN(cents(discount))} de interés? Se cobrará todo el capital pendiente. El préstamo quedará liquidado; la operación quedará registrada en el historial.`,
    );
  }
  return (
    <details className="surface p-5">
      <summary className="min-h-11 cursor-pointer font-semibold">
        Cancelación anticipada con descuento
      </summary>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <p className="text-sm text-slate-500">
          Descuenta únicamente interés pendiente y cobra todo el capital restante.
          El interés ya cobrado se conserva. Disponible antes del vencimiento.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            Descuento de interés (S/)
            <input required inputMode="decimal" placeholder="0.00" value={discount}
              onChange={e => setDiscount(e.target.value)} />
          </label>
          <label>
            Fecha de cancelación
            <input required type="date" value={paidOn} min={period.start_date}
              max={today < period.end_date ? today : period.end_date}
              onChange={e => setPaidOn(e.target.value)} />
          </label>
        </div>
        {error && <p role="alert">{error}</p>}
        {!validDate && <p role="alert">La fecha debe ser anterior al vencimiento y no ser futura.</p>}
        {quote && (
          <dl className="grid gap-3 sm:grid-cols-3">
            <div><dt>Capital a cobrar</dt><dd>{formatPEN(loan.capital_pending)}</dd></div>
            <div><dt>Interés a cobrar</dt><dd>{formatPEN(quote.interestCents)}</dd></div>
            <div><dt>Total de cancelación</dt><dd className="font-semibold">{formatPEN(quote.totalCents)}</dd></div>
          </dl>
        )}
        <Button type="submit" disabled={busy || !quote || !validDate}>
          {busy ? "Registrando…" : "Confirmar cancelación anticipada"}
        </Button>
      </form>
    </details>
  );
}
