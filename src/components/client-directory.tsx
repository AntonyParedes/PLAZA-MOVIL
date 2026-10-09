"use client";
import { useEffect, useState } from "react";
import { ChevronDown, MessageCircle, Pencil, RefreshCw } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import {
  clientAccount,
  clientWhatsApp,
  type AccountData,
} from "@/lib/client-account";
import { dateLabel, limaDate, type Customer } from "@/lib/portal";
import { formatPEN } from "@/lib/finance";
import { Badge, EmptyState, Notice, PaymentBadge } from "./ui/dashboard";
import { Button } from "./ui/button";
type DirectoryClient = Customer & {
  address: string;
  notes: string | null;
  created_at: string;
};
const supabase = getSupabase();
export default function ClientDirectory({
  clients,
  role,
  onEdit,
}: {
  clients: DirectoryClient[];
  role: "administrador" | "jefe";
  onEdit: (client: DirectoryClient) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [data, setData] = useState<AccountData>({
    loans: [],
    periods: [],
    payments: [],
    installments: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [today, setToday] = useState(limaDate);
  useEffect(() => {
    const timer = setInterval(() => setToday(limaDate()), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let active = true;
    async function fetchRows(table: string) {
      const rows: unknown[] = [];
      for (let offset = 0; ; offset += 1000) {
        const result = await supabase!
          .from(table)
          .select("*")
          .order("id")
          .range(offset, offset + 999);
        if (result.error)
          throw Error(
            "No se pudieron cargar los préstamos. Intenta actualizar.",
          );
        rows.push(...result.data);
        if (result.data.length < 1000) return rows;
      }
    }
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [loans, periods, payments, installments] = await Promise.all(
          ["loans", "loan_periods", "payments", "installment_balances"].map(
            fetchRows,
          ),
        );
        if (active)
          setData({ loans, periods, payments, installments } as AccountData);
      } catch {
        if (active)
          setError("No se pudieron cargar los préstamos. Intenta actualizar.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [revision]);
  return (
    <div className="space-y-3">
      {error && <Notice error>{error}</Notice>}
      <div className="flex items-center justify-between gap-3">
        <p role="status" className="text-xs text-slate-500">
          {loading
            ? "Actualizando préstamos…"
            : "Pulsa un nombre para ver su cuenta. WhatsApp prepara el mensaje; tú lo envías."}
        </p>
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => setRevision((r) => r + 1)}
        >
          <RefreshCw size={15} /> Actualizar
        </Button>
      </div>
      {!clients.length && (
        <EmptyState
          title="No se encontraron clientes"
          description="Registra un cliente o ajusta la búsqueda para continuar."
        />
      )}
      {clients.map((client) => {
        const account = clientAccount(client.id, data, today);
        const open = expanded === client.id;
        const tone =
          account.state === "En mora"
            ? "danger"
            : account.state === "Atrasado"
              ? "warning"
              : account.state === "Sin préstamos"
                ? "neutral"
                : "success";
        const stateLabel =
          account.state === "Atrasado"
            ? `Se atrasó ${account.daysLate} días`
            : account.state;
        const ready = !loading && !error;
        return (
          <article
            key={client.id}
            aria-label={client.full_name}
            className="surface overflow-hidden"
          >
            <div className="flex flex-col items-stretch gap-3 p-4 sm:flex-row sm:items-center sm:p-5">
              <button
                className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1 text-left hover:bg-slate-50"
                aria-expanded={open}
                aria-controls={`account-${client.id}`}
                onClick={() => setExpanded(open ? null : client.id)}
              >
                <span
                  aria-hidden="true"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent-soft)] font-semibold text-[var(--accent-text)]"
                >
                  {client.full_name
                    .trim()
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((n) => n[0])
                    .join("")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-semibold text-slate-900">
                    {client.full_name}
                  </span>
                  <span className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge
                      tone={client.member_type === "socio" ? "info" : "neutral"}
                    >
                      {client.member_type ?? "Condición por registrar"}
                    </Badge>
                    <span className="text-xs text-slate-500">
                      Stand {client.stand_code ?? "por registrar"}
                    </span>
                  </span>
                </span>
                <ChevronDown
                  aria-hidden="true"
                  size={18}
                  className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
                />
              </button>
              {ready && /^9\d{8}$/.test(client.phone) ? (
                <a
                  className="inline-flex min-h-11 self-end items-center justify-center gap-2 rounded-xl border border-[var(--brand-border)] sm:self-auto bg-[var(--brand-soft)] px-4 text-sm font-semibold text-[var(--brand-text)] hover:brightness-95"
                  aria-label={`WhatsApp de ${client.full_name}`}
                  href={`https://wa.me/51${client.phone}?text=${encodeURIComponent(clientWhatsApp(client, data, today))}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MessageCircle size={18} /> WhatsApp
                </a>
              ) : (
                <Button
                  variant="outline"
                  disabled
                  aria-label={`WhatsApp de ${client.full_name}`}
                >
                  <MessageCircle size={18} /> WhatsApp
                </Button>
              )}
            </div>
            {open && (
              <div
                id={`account-${client.id}`}
                role="region"
                aria-label={`Cuenta de ${client.full_name}`}
                className={`client-account client-account-${ready ? tone : "neutral"} space-y-5 border-t p-4 sm:p-6`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">Estado de su cuenta</h3>
                    {ready && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Badge tone={tone}>{stateLabel}</Badge>
                        {account.entries.some((e) => e.refinanced) && (
                          <Badge tone="info">Ha refinanciado</Badge>
                        )}
                      </div>
                    )}
                  </div>
                  {role === "administrador" && (
                    <Button variant="outline" onClick={() => onEdit(client)}>
                      <Pencil size={15} /> Editar
                    </Button>
                  )}
                </div>
                {ready ? (
                  <>
                    <dl className="grid gap-3 sm:grid-cols-2">
                      {[
                        ["Saldo", account.balance],
                        [
                          "Interés cobrado (ganancia)",
                          account.interestCollected,
                        ],
                      ].map(([label, value]) => (
                        <div
                          key={String(label)}
                          className="rounded-2xl border border-slate-200 bg-white p-4"
                        >
                          <dt className="text-xs text-slate-500">
                            {String(label)}
                          </dt>
                          <dd className="mt-2 break-words text-xl font-semibold">
                            {formatPEN(value as bigint)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <div className="space-y-3">
                      {account.entries.map((entry) => (
                        <section
                          key={entry.loan.id}
                          className="rounded-2xl border border-slate-200 bg-white p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h4 className="font-semibold">
                              Préstamo del{" "}
                              {entry.startDate
                                ? dateLabel(entry.startDate)
                                : "registro pendiente"}
                            </h4>
                            <PaymentBadge status={entry.state} />
                          </div>
                          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                            <div>
                              <dt className="text-xs text-slate-500">Saldo</dt>
                              <dd className="mt-1 font-semibold">
                                {formatPEN(entry.balance)}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs text-slate-500">
                                Cuota semanal
                              </dt>
                              <dd className="mt-1">
                                {formatPEN(entry.weeklyCents)}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs text-slate-500">
                                Días de atraso
                              </dt>
                              <dd className="mt-1">
                                {entry.daysLate}
                                {entry.nextDate
                                  ? ` · Próxima cuota: ${dateLabel(entry.nextDate)}`
                                  : ""}
                              </dd>
                            </div>
                          </dl>
                          {entry.refinanced && (
                            <p className="mt-3 text-xs text-[var(--accent-text)]">
                              Préstamo refinanciado
                            </p>
                          )}
                          <details className="mt-4">
                            <summary className="min-h-11 py-3 text-sm font-semibold">
                              Ver cuotas e historial
                            </summary>
                            <div className="space-y-2">
                              {data.installments
                                .filter((i) => i.loan_id === entry.loan.id)
                                .sort((a, b) => {
                                  const pa =
                                    data.periods.find(
                                      (p) => p.id === a.period_id,
                                    )?.number ?? 0;
                                  const pb =
                                    data.periods.find(
                                      (p) => p.id === b.period_id,
                                    )?.number ?? 0;
                                  return pa - pb || a.number - b.number;
                                })
                                .map((i) => (
                                  <div
                                    key={i.id}
                                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3 text-sm"
                                  >
                                    <span>
                                      Periodo{" "}
                                      {data.periods.find(
                                        (p) => p.id === i.period_id,
                                      )?.number ?? "—"}{" "}
                                      · Cuota {i.number} ·{" "}
                                      {dateLabel(i.due_date)}
                                      {!i.is_current ? " · Histórico" : ""}
                                    </span>
                                    <span>
                                      Pagado: {formatPEN(i.paid_cents)} · Saldo:{" "}
                                      {formatPEN(i.pending_cents)}
                                    </span>
                                  </div>
                                ))}
                              <h5 className="pt-3 text-sm font-semibold">
                                Pagos recibidos
                              </h5>
                              {account.payments
                                .filter((p) => p.loan_id === entry.loan.id)
                                .sort((a, b) =>
                                  b.paid_on.localeCompare(a.paid_on),
                                )
                                .map((p) => (
                                  <div
                                    key={p.id}
                                    className="rounded-xl bg-slate-50 p-3 text-sm"
                                  >
                                    {dateLabel(p.paid_on)} ·{" "}
                                    {formatPEN(p.amount_cents)} · Interés:{" "}
                                    {formatPEN(p.interest_cents)} · Capital:{" "}
                                    {formatPEN(p.capital_cents)}
                                  </div>
                                ))}
                              {!account.payments.some(
                                (p) => p.loan_id === entry.loan.id,
                              ) && (
                                <p className="text-sm text-slate-500">
                                  Aún no tiene pagos registrados.
                                </p>
                              )}
                            </div>
                          </details>
                        </section>
                      ))}
                    </div>
                  </>
                ) : (
                  <p role="status" className="text-sm text-slate-500">
                    {error
                      ? "No hay información financiera disponible. Actualiza para reintentar."
                      : "Cargando saldos e historial…"}
                  </p>
                )}
                <dl className="grid gap-3 border-t border-slate-200 pt-5 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-slate-500">DNI</dt>
                    <dd>{client.dni}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Celular</dt>
                    <dd>{client.phone}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Dirección</dt>
                    <dd className="break-words">{client.address}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Registro</dt>
                    <dd>
                      {new Intl.DateTimeFormat("es-PE", {
                        timeZone: "America/Lima",
                      }).format(new Date(client.created_at))}
                    </dd>
                  </div>
                  {client.notes && (
                    <div className="sm:col-span-2">
                      <dt className="text-xs text-slate-500">Observaciones</dt>
                      <dd className="break-words">{client.notes}</dd>
                    </div>
                  )}
                </dl>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
