"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Banknote, CircleDollarSign, RefreshCw } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cents, formatPEN } from "@/lib/finance";
import { dateLabel } from "@/lib/portal";
import { cashKindLabel, cashSummarySchema, cashMoney, type CashMovement, type CashSummary } from "@/lib/cash";
import { useLiveRevision } from "@/hooks/use-live-revision";
import { Button } from "./ui/button";
import { Card, DataTable, Kpi, Notice, SectionHeading, Sheet } from "./ui/dashboard";

const supabase = getSupabase();
function messageFor(error: { code?: string; message: string }) {
  if (error.code === "PGRST202" || error.code === "42P01" || /schema cache|Could not find.*function/i.test(error.message))
    return "Para habilitar Caja, ejecuta la migración 202610270009_cash.sql en Supabase SQL Editor.";
  return error.message;
}
export default function CashOverview({ role }: { role: "administrador" | "jefe" }) {
  const [summary, setSummary] = useState<CashSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const liveRevision = useLiveRevision(true, true);
  const [open, setOpen] = useState(false);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [kind, setKind] = useState<"aporte" | "retiro">("aporte");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");
  const lock = useRef(false);
  const requests = useRef(new Map<string, string>());
  const configured = useRef<boolean | null>(null);
  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const result = await supabase!.rpc("cash_summary");
        if (result.error) throw Error(messageFor(result.error));
        const validated = cashSummarySchema.safeParse(result.data);
        if (!validated.success) throw Error("No se pudo verificar el resumen de caja. Intenta actualizar.");
        if (active) {
          // Never turn an opening-balance draft into a contribution after another admin sets up cash.
          if (configured.current === false && validated.data.configured) { setAmount(""); setNote(""); }
          configured.current = validated.data.configured;
          setSummary(validated.data); setError("");
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "No se pudo actualizar la caja.");
      } finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [revision, liveRevision]);
  useEffect(() => {
    if (!open || !summary) return;
    let active = true;
    async function load() {
      setHistoryLoading(true);
      try {
        const rows: CashMovement[] = [];
        for (let offset = 0; ; offset += 1000) {
          const result = await supabase!.from("cash_movements").select("id,kind,amount_cents,note,created_at").order("created_at", { ascending: false }).order("id").range(offset, offset + 999);
          if (result.error) throw Error(messageFor(result.error));
          rows.push(...result.data as CashMovement[]);
          if (result.data.length < 1000) break;
        }
        if (active) { setMovements(rows); setHistoryError(""); }
      } catch (cause) {
        if (active) setHistoryError(cause instanceof Error ? cause.message : "No se pudo cargar el historial de caja.");
      } finally { if (active) setHistoryLoading(false); }
    }
    void load();
    return () => { active = false; };
  // A new summary arrives after every refresh, including after a movement is recorded.
  }, [open, summary]);
  async function record(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!summary || loading || error || lock.current || role !== "administrador") return;
    setFormError("");
    setSuccess("");
    const movementKind = summary.configured ? kind : "apertura";
    let value: number;
    try {
      value = cents(amount);
      if (value < 0 || (movementKind !== "apertura" && value === 0)) throw Error("Ingresa un importe mayor que cero.");
      if (note.trim().length < 3 || note.trim().length > 300) throw Error("Escribe un motivo de 3 a 300 caracteres.");
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : "Revisa el importe."); return; }
    const key = JSON.stringify([movementKind, value.toString(), note.trim()]);
    const requestId = requests.current.get(key) ?? crypto.randomUUID();
    requests.current.set(key, requestId);
    lock.current = true;
    setBusy(true);
    try {
      const result = await supabase!.rpc("record_cash_movement", { p_request: requestId, p_kind: movementKind, p_amount: Number(value), p_note: note.trim() });
      if (result.error) throw Error(messageFor(result.error));
      if (typeof result.data !== "string") throw Error("No se pudo confirmar el registro. Intenta nuevamente.");
      requests.current.delete(key);
      setAmount(""); setNote("");
      setSuccess("Movimiento registrado. Se está actualizando el saldo.");
      setRevision(n => n + 1);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "No se pudo registrar. Revisa la conexión e intenta nuevamente.");
    } finally { lock.current = false; setBusy(false); }
  }
  const negative = summary?.balance_cents !== null && summary?.balance_cents !== undefined && BigInt(summary.balance_cents) < 0n;
  const refreshButton = <Button variant="outline" disabled={loading || busy} onClick={() => setRevision(n => n + 1)} aria-label="Actualizar caja"><RefreshCw size={16} /> Actualizar caja</Button>;
  return <section aria-label="Caja y ganancias" className="space-y-4">
    <SectionHeading title="Caja y ganancias" description="Resumen de toda la operación, independiente de la búsqueda de clientes." action={<div className="flex flex-wrap gap-2">{refreshButton}{summary && <Button variant="outline" onClick={() => { setOpen(true); setSuccess(""); }}>Ver caja</Button>}</div>} />
    {error && <Notice error>{error}{summary && " Se muestran los últimos valores cargados."}</Notice>}
    {!summary ? <Card><p role="status">{loading ? "Cargando caja y ganancias…" : "Caja no disponible. Revisa el aviso y vuelve a actualizar."}</p></Card> : <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Kpi label="Caja disponible" value={summary.balance_cents === null ? "Sin configurar" : cashMoney(summary.balance_cents)} note="Dinero inicial + aportes + pagos recibidos − préstamos entregados − retiros" icon={Banknote} tone={negative ? "red" : "green"} />
        <Kpi label="Interés cobrado (ganancia)" value={formatPEN(BigInt(summary.interest_cents))} note="Total histórico cobrado. El capital recuperado y el interés pendiente no son ganancia." icon={CircleDollarSign} tone="purple" />
      </div>
      {!summary.configured && <Notice>Registra el dinero inicial anterior a todos los préstamos del sistema para calcular la caja.{role === "jefe" && " Solicita esta configuración a un administrador."}</Notice>}
      {negative && <Notice error>La caja calculada es negativa. Revisa el dinero inicial, los aportes, los retiros y las operaciones registradas para conciliarla con el dinero real.</Notice>}
      <p role="status" className="text-xs text-slate-500">{loading ? "Actualizando caja…" : `Actualización automática · Fecha de Lima: ${dateLabel(summary.as_of)}`}</p>
    </>}
    <Sheet open={open} onOpenChange={next => { if (!busy) setOpen(next); }} title="Caja y ganancias" description="Consulta el cálculo y registra movimientos de dinero.">
      {summary && <div className="space-y-6">
        {error && <Notice error>{error} Se conserva el último resumen; actualízalo antes de registrar.</Notice>}
        <dl className="grid gap-4 rounded-xl bg-[var(--brand-soft)] p-4 sm:grid-cols-2">
          <div><dt className="text-sm">Caja disponible</dt><dd className="mt-1 break-words text-xl font-semibold tabular-nums">{summary.balance_cents === null ? "Sin configurar" : cashMoney(summary.balance_cents)}</dd></div>
          <div><dt className="text-sm">Interés cobrado (ganancia)</dt><dd className="mt-1 break-words text-xl font-semibold tabular-nums">{formatPEN(BigInt(summary.interest_cents))}</dd></div>
        </dl>
        <dl className="grid grid-cols-2 gap-4 rounded-xl bg-slate-50 p-4 text-sm">
          {([["Dinero inicial", summary.opening_cents], ["Aportes", summary.contributions_cents], ["Pagos recibidos", summary.received_cents], ["Préstamos entregados", summary.disbursed_cents], ["Retiros", summary.withdrawals_cents], ["Interés cobrado este mes", summary.month_interest_cents]] as const).map(([label, value]) => <div key={label}><dt className="text-slate-500">{label}</dt><dd className="mt-1 break-words font-semibold tabular-nums">{formatPEN(BigInt(value))}</dd></div>)}
        </dl>
        <p className="text-sm text-slate-500">Los pagos y desembolsos se incluyen automáticamente. No los registres otra vez como aportes o retiros. Refinanciar no entrega dinero adicional ni suma el interés pendiente como ganancia.</p>
        {role === "administrador" && <form onSubmit={record} className="space-y-4 rounded-2xl border border-slate-200 p-4">
          <h3 className="font-semibold">{summary.configured ? "Registrar movimiento de caja" : "Configurar dinero inicial"}</h3>
          {!summary.configured && <Notice>Ingresa el capital con el que empezaste antes del primer préstamo registrado, no el efectivo que tienes hoy. La aplicación restará los préstamos y sumará los pagos ya registrados. Si comenzaste sin dinero inicial, registra S/0.</Notice>}
          {summary.configured && <label className="block">Tipo de movimiento<select className="mt-2" value={kind} onChange={e => setKind(e.target.value as "aporte" | "retiro")} disabled={busy}><option value="aporte">Aporte de dinero</option><option value="retiro">Retiro de dinero</option></select></label>}
          <label className="block">{summary.configured ? "Importe (S/)" : "Dinero inicial (S/)"}<input className="mt-2" value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" autoComplete="off" placeholder="0.00" required disabled={busy} /></label>
          <label className="block">Motivo del movimiento<textarea className="mt-2" value={note} onChange={e => setNote(e.target.value)} required minLength={3} maxLength={300} rows={2} disabled={busy} placeholder="Describe de dónde entra o por qué sale el dinero" /></label>
          <p className="text-xs text-slate-500">El registro conserva fecha, autor y motivo. Para corregir un importe usa un movimiento compensatorio con su explicación.</p>
          {formError && <Notice error>{formError}</Notice>}
          {success && <Notice>{success}</Notice>}
          <Button type="submit" disabled={busy || loading || Boolean(error)}>{busy ? "Registrando…" : summary.configured ? "Registrar movimiento" : "Guardar dinero inicial"}</Button>
        </form>}
        <div className="flex justify-end">{refreshButton}</div>
        <section aria-label="Movimientos manuales de caja">
          <h3 className="mb-3 font-semibold">Movimientos de caja</h3>
          {historyError && <Notice error>{historyError}</Notice>}
          {historyLoading && <p role="status" className="mb-3 text-sm text-slate-500">Actualizando movimientos…</p>}
          <DataTable headers={["Fecha (Lima)", "Movimiento", "Importe", "Motivo"]} caption="Aportes y retiros de caja" keys={movements.map(m => m.id)} rows={movements.map(m => [new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", dateStyle: "short", timeStyle: "short" }).format(new Date(m.created_at)), cashKindLabel[m.kind], formatPEN(BigInt(m.amount_cents)), m.note])} emptyTitle={historyError ? "No se pudo cargar el historial" : "Sin movimientos registrados"} emptyDescription="Aquí aparecen el dinero inicial, los aportes y los retiros. Los préstamos y pagos se consultan en sus módulos." />
        </section>
      </div>}
    </Sheet>
  </section>;
}
