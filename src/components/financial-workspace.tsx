"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { getSupabase } from "@/lib/supabase";
import {
  cents,
  decimalSoles,
  formatPEN,
  loanProducts,
  scheduleLoan,
} from "@/lib/finance";
import {
  addDays,
  dateLabel,
  downloadCSV,
  limaDate,
  weekBounds,
  type Customer,
  type Loan,
  type Period,
  type Payment,
  type Installment,
} from "@/lib/portal";
import { collectionStatus, weekdayLabel } from "@/lib/collection-status";
import { downloadCreditWorkbook } from "@/lib/credit-export";
import { whatsappReminder } from "@/lib/whatsapp-reminder";
import { Button } from "@/components/ui/button";
import {
  RefreshCw,
  Download,
  Plus,
  MessageCircle,
  Search,
  Wallet,
  CircleDollarSign,
  TrendingUp,
  Banknote,
  CalendarDays,
  Clock3,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";
import {
  Badge,
  Card,
  DataTable,
  Kpi,
  LoadingSkeleton,
  Notice,
  PaymentBadge,
  SectionHeading,
  Sheet,
} from "@/components/ui/dashboard";
export type FinancialView =
  | "general"
  | "resumen"
  | "prestamos"
  | "cobranzas"
  | "refinanciaciones"
  | "historial"
  | "reportes";
const supabase = getSupabase();
const money = (value: number | bigint) => formatPEN(value);
export default function FinancialWorkspace({
  clients,
  role,
  view = "general",
  clientFocus,
  search,
  onSearchChange: setSearch,
}: {
  clients: Customer[];
  role: "administrador" | "jefe";
  view?: FinancialView;
  clientFocus?: string;
  search: string;
  onSearchChange: (value: string) => void;
}) {
  const [data, setData] = useState<{
    loans: Loan[];
    periods: Period[];
    payments: Payment[];
    installments: Installment[];
  }>({ loans: [], periods: [], payments: [], installments: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [revision, setRevision] = useState(0);
  const tab = view;
  const [success, setSuccess] = useState("");
  const [agendaRange, setAgendaRange] = useState<"hoy" | "semana">("hoy");
  const [collectionFilter, setCollectionFilter] = useState("pendientes");
  const [stateFilter, setStateFilter] = useState("todos");
  const [memberFilter, setMemberFilter] = useState("todos");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState("");
  const [productId, setProductId] = useState("");
  const product = loanProducts.find((p) => p.id === productId);
  const [start, setStart] = useState(limaDate);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paidOn, setPaidOn] = useState(limaDate);
  const [preview, setPreview] = useState<ReturnType<
    typeof scheduleLoan
  > | null>(null);
  const mutationLock = useRef(false);
  const requests = useRef(new Map<string, string>());
  useEffect(() => {
    let active = true;
    async function fetchAll(table: string) {
      const rows: unknown[] = [];
      for (let offset = 0; ; offset += 1000) {
        const result = await supabase!
          .from(table)
          .select("*")
          .order("id")
          .range(offset, offset + 999);
        if (result.error)
          throw new Error(
            "No se pudieron cargar operaciones. Verifica las migraciones y la conexión.",
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
            fetchAll,
          ),
        );
        if (active)
          setData({
            loans: loans as Loan[],
            periods: periods as Period[],
            payments: payments as Payment[],
            installments: installments as Installment[],
          });
      } catch (e) {
        if (active)
          setError(e instanceof Error ? e.message : "Error de conexión.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [revision]);
  const customer = (loan: Loan) => clients.find((c) => c.id === loan.client_id);
  const current = (loanId: string) =>
    data.periods.find((p) => p.loan_id === loanId && p.is_current);
  const loanById = (id: string) => data.loans.find((l) => l.id === id);
  const within = (date: string) =>
    (!from || date >= from) && (!to || date <= to);
  const matches = (loan: Loan) =>
    (!clientFocus || loan.client_id === clientFocus) &&
    `${customer(loan)?.full_name ?? ""} ${customer(loan)?.dni ?? ""} ${customer(loan)?.stand_code ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase());
  const loans = data.loans.filter(
    (l) =>
      matches(l) &&
      within(
        data.periods.find((p) => p.loan_id === l.id && p.number === 1)
          ?.start_date ?? "",
      ),
  );
  const payments = data.payments.filter(
    (p) =>
      within(p.paid_on) &&
      Boolean(loanById(p.loan_id) && matches(loanById(p.loan_id)!)),
  );
  const installments = data.installments.filter(
    (i) =>
      i.is_current &&
      i.pending_cents > 0 &&
      Boolean(loanById(i.loan_id) && matches(loanById(i.loan_id)!)),
  );
  const [today, setToday] = useState(limaDate);
  useEffect(() => {
    const timer = setInterval(() => setToday(limaDate()), 60000);
    return () => clearInterval(timer);
  }, []);
  const week = weekBounds(today);
  const selectedLoan = loanById(selected);
  const selectedPeriod = current(selected);
  const selectedQuotas = data.installments
    .filter(
      (i) => i.loan_id === selected && i.is_current && i.pending_cents > 0,
    )
    .sort((a, b) => a.number - b.number);
  const quotaAmount = (count: number) =>
    selectedQuotas
      .slice(0, count)
      .reduce((sum, i) => sum + BigInt(i.pending_cents), 0n);
  const activeClients = new Set(
    data.loans.filter((l) => l.status === "activo").map((l) => l.client_id),
  );
  async function mutate(
    name: string,
    args: Record<string, string | number>,
    confirmation: string,
  ) {
    if (role !== "administrador" || mutationLock.current) return;
    if (!window.confirm(confirmation)) return;
    mutationLock.current = true;
    setBusy(true);
    setError("");
    setSuccess("");
    const signature = JSON.stringify([name, args]);
    const id = requests.current.get(signature) ?? crypto.randomUUID();
    requests.current.set(signature, id);
    try {
      const result = await supabase!.rpc(name, { ...args, p_request: id });
      if (result.error) throw new Error(result.error.message);
      setSuccess(
        name === "record_payment"
          ? "Pago registrado correctamente."
          : name === "refinance_loan"
            ? "Refinanciación registrada. El nuevo periodo ya está disponible."
            : "Préstamo registrado correctamente.",
      );
      requests.current.delete(signature);
      setShowNew(false);
      setPaymentAmount("");
      setPreview(null);
      setRevision((r) => r + 1);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "No se pudo completar la operación. Puedes reintentar con los mismos datos.",
      );
    } finally {
      mutationLock.current = false;
      setBusy(false);
    }
  }
  function prepareLoan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      if (!product) throw new Error("Selecciona un producto de préstamo.");
      setPreview(
        scheduleLoan(product.capital, product.rate, product.months, start),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Datos inválidos.");
    }
  }
  async function createLoan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview || !product) return;
    const fields = new FormData(event.currentTarget);
    await mutate(
      "create_loan",
      {
        p_client: String(fields.get("client")),
        p_capital: preview.originalCapital,
        p_rate: product.rate,
        p_months: product.months,
        p_start: start,
      },
      `¿Desembolsar ${money(preview.originalCapital)} y registrar una deuda total de ${money(preview.totalCents)}? El préstamo no se podrá cancelar ni eliminar.`,
    );
  }
  async function pay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await mutate(
        "record_payment",
        { p_loan: selected, p_amount: cents(paymentAmount), p_paid_on: paidOn },
        `¿Registrar un pago de ${money(cents(paymentAmount))}? Se aplicará primero a intereses y después a capital. No se podrá anular.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Monto inválido.");
    }
  }
  function exportReport(kind: string) {
    if (kind === "pagos")
      downloadCSV("pagos-pm-creditos.csv", [
        ["Cliente", "Fecha", "Total PEN", "Interés PEN", "Capital PEN"],
        ...payments.map((p) => [
          customer(loanById(p.loan_id)!)?.full_name ?? "",
          p.paid_on,
          decimalSoles(p.amount_cents),
          decimalSoles(p.interest_cents),
          decimalSoles(p.capital_cents),
        ]),
      ]);
    else if (kind === "vencidos")
      downloadCSV("cuotas-vencidas.csv", [
        ["Cliente", "Cuota", "Vencimiento", "Saldo PEN"],
        ...installments
          .filter((i) => i.due_date < today && within(i.due_date))
          .map((i) => [
            customer(loanById(i.loan_id)!)?.full_name ?? "",
            i.number,
            i.due_date,
            decimalSoles(i.pending_cents),
          ]),
      ]);
    else if (kind === "refinanciaciones")
      downloadCSV("refinanciaciones.csv", [
        ["Cliente", "Periodo", "Inicio", "Fin", "Capital PEN", "Interés PEN"],
        ...data.periods
          .filter(
            (p) =>
              p.number > 1 &&
              within(p.start_date) &&
              Boolean(loanById(p.loan_id) && matches(loanById(p.loan_id)!)),
          )
          .map((p) => [
            customer(loanById(p.loan_id)!)?.full_name ?? "",
            p.number,
            p.start_date,
            p.end_date,
            decimalSoles(p.opening_capital),
            decimalSoles(p.interest_generated),
          ]),
      ]);
    else
      downloadCSV(`prestamos-${kind}.csv`, [
        [
          "Cliente",
          "DNI",
          "Estado",
          "Capital original PEN",
          "Capital pendiente PEN",
          "Interés pendiente PEN",
        ],
        ...loans
          .filter((l) => kind === "todos" || l.status === kind)
          .map((l) => [
            customer(l)?.full_name ?? "",
            customer(l)?.dni ?? "",
            l.status,
            decimalSoles(l.original_capital),
            decimalSoles(l.capital_pending),
            decimalSoles(l.interest_pending),
          ]),
      ]);
  }
  const totals = {
    lent: loans.reduce((n, l) => n + BigInt(l.original_capital), 0n),
    capital: loans.reduce((n, l) => n + BigInt(l.capital_pending), 0n),
    interest: payments.reduce((n, p) => n + BigInt(p.interest_cents), 0n),
    paid: payments.reduce((n, p) => n + BigInt(p.amount_cents), 0n),
  };
  const groups = (key: "semana" | "mes") => {
    const map = new Map<string, { total: bigint; interest: bigint }>();
    payments.forEach((p) => {
      const date =
        key === "mes" ? p.paid_on.slice(0, 7) : weekBounds(p.paid_on).start;
      const value = map.get(date) ?? { total: 0n, interest: 0n };
      value.total += BigInt(p.amount_cents);
      value.interest += BigInt(p.interest_cents);
      map.set(date, value);
    });
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
  };
  const generalEntries = loans
    .map((loan) => ({
      loan,
      client: customer(loan),
      status: collectionStatus(loan, data.periods, data.installments, today),
    }))
    .filter(
      (row) =>
        (memberFilter === "todos" ||
          row.client?.member_type === memberFilter) &&
        (stateFilter === "todos" ||
          (stateFilter === "refinanciado"
            ? row.status.refinanced
            : row.status.state === stateFilter)),
    );
  const generalHeaders = [
    "Nombres y apellidos",
    "Código stand",
    "Condición",
    "Fecha del préstamo",
    "Saldo",
    "Cuota semanal",
    "Día de pago",
    "Estado",
    "Días de atraso",
    "Refinanciado",
  ];
  const visibleSchedule = data.installments.filter(
    (i) =>
      i.is_current &&
      Boolean(loanById(i.loan_id) && matches(loanById(i.loan_id)!)),
  );
  const agenda = visibleSchedule
    .filter((i) =>
      agendaRange === "hoy"
        ? i.due_date === today
        : i.due_date >= week.start && i.due_date <= week.end,
    )
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  const collectionRows = visibleSchedule
    .filter(
      (i) =>
        within(i.due_date) &&
        (collectionFilter === "todos" ||
          (collectionFilter === "pagadas"
            ? i.pending_cents === 0
            : collectionFilter === "vencidas"
              ? i.pending_cents > 0 && i.due_date < today
              : i.pending_cents > 0)),
    )
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  const refinanced = data.periods
    .filter(
      (p) =>
        p.number > 1 &&
        within(p.start_date) &&
        Boolean(loanById(p.loan_id) && matches(loanById(p.loan_id)!)),
    )
    .sort((a, b) => b.start_date.localeCompare(a.start_date));
  function customerCell(loan: Loan) {
    const c = customer(loan);
    return (
      <div>
        <p className="font-semibold text-slate-900">
          {c?.full_name ?? "Cliente no disponible"}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Stand {c?.stand_code ?? "por registrar"} ·{" "}
          {c?.member_type ?? "por registrar"}
        </p>
      </div>
    );
  }
  function statusBadge(loan: Loan) {
    const status = collectionStatus(
      loan,
      data.periods,
      data.installments,
      today,
    );
    return (
      <Badge
        tone={
          status.state === "En mora"
            ? "danger"
            : status.state === "Atrasado"
              ? "warning"
              : "success"
        }
      >
        {status.state === "Atrasado"
          ? `Se atrasó ${status.daysLate} ${status.daysLate === 1 ? "día" : "días"}`
          : status.state}
      </Badge>
    );
  }
  function quotaBadge(i: Installment) {
    return (
      <PaymentBadge
        status={
          i.pending_cents === 0
            ? "pagado"
            : i.due_date < today
              ? "vencido"
              : i.paid_cents > 0
                ? "pago parcial"
                : "pendiente"
        }
      />
    );
  }
  function quotaTable(rows: Installment[], includeWhatsapp = false) {
    return (
      <DataTable
        caption="Cronograma de cobros"
        headers={[
          "Cliente",
          "Cuota",
          "Día de pago",
          "Programado",
          "Saldo",
          "Estado",
          "Acción",
        ]}
        keys={rows.map((i) => i.id)}
        rows={rows.map((i) => {
          const l = loanById(i.loan_id)!;
          const c = customer(l);
          const text = c
            ? whatsappReminder(c, l, i, data.periods, data.installments, today)
            : "";
          return [
            customerCell(l),
            i.number,
            <div key="date">
              <p className="capitalize">{weekdayLabel(i.due_date)}</p>
              <p className="mt-1 text-xs text-slate-500">
                {dateLabel(i.due_date)}
              </p>
            </div>,
            money(i.scheduled_cents),
            money(i.pending_cents),
            quotaBadge(i),
            <div key="actions" className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setSelected(l.id)}>
                {i.pending_cents > 0 && role === "administrador"
                  ? "Registrar pago"
                  : "Ver préstamo"}
              </Button>
              {includeWhatsapp && c && i.pending_cents > 0 && (
                <Button asChild variant="outline">
                  <a
                    aria-label={`Recordar pago a ${c.full_name} por WhatsApp`}
                    href={`https://wa.me/51${c.phone}?text=${encodeURIComponent(text)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <MessageCircle size={16} />
                    <span className="sr-only lg:not-sr-only">WhatsApp</span>
                  </a>
                </Button>
              )}
            </div>,
          ];
        })}
        emptyTitle={
          agendaRange === "hoy"
            ? "Sin cobros programados para hoy"
            : "Sin cuotas para este rango"
        }
        emptyDescription="Consulta esta semana o ajusta los filtros para revisar el cronograma."
      />
    );
  }
  function exportGeneral() {
    downloadCSV("panel-general.csv", [
      generalHeaders,
      ...generalEntries.map(({ client, status }) => [
        client?.full_name ?? "",
        client?.stand_code ?? "Por registrar",
        client?.member_type ?? "Por registrar",
        status.startDate ?? "",
        decimalSoles(status.balance),
        decimalSoles(status.weeklyCents),
        status.nextDate ?? "",
        status.state === "Atrasado"
          ? `Se atrasó ${status.daysLate} días`
          : status.state,
        status.daysLate,
        status.refinanced ? "Sí" : "No",
      ]),
    ]);
  }
  async function exportExcel(kind = "todos") {
    if (exporting) return;
    setExporting(true);
    setError("");
    try {
      let selectedIds = loans
        .filter((l) => kind === "todos" || l.status === kind)
        .map((l) => l.id);
      if (kind === "general")
        selectedIds = generalEntries.map((e) => e.loan.id);
      if (kind === "cobranzas")
        selectedIds = collectionRows.map((i) => i.loan_id);
      if (kind === "pagos") selectedIds = payments.map((p) => p.loan_id);
      if (kind === "vencidos")
        selectedIds = installments
          .filter((i) => i.due_date < today && within(i.due_date))
          .map((i) => i.loan_id);
      if (kind === "refinanciaciones")
        selectedIds = refinanced.map((p) => p.loan_id);
      await downloadCreditWorkbook(
        {
          clients,
          ...data,
          today,
          selectedLoanIds: [...new Set(selectedIds)],
          description: `Selección: ${kind}. Búsqueda: ${search || "todos"}. Desde: ${from || "sin límite"}. Hasta: ${to || "sin límite"}. Incluye el historial completo de los préstamos seleccionados.`,
        },
        `pm-creditos-${kind}.xlsx`,
      );
      setSuccess(
        "Excel descargado. Incluye cartera, cuotas, pagos y refinanciaciones.",
      );
    } catch {
      setError("No se pudo generar el Excel. Inténtalo nuevamente.");
    } finally {
      setExporting(false);
    }
  }
  if (loading && revision === 0) return <LoadingSkeleton />;
  return (
    <section className="space-y-6" aria-busy={loading}>
      {loading && (
        <p role="status" className="text-sm text-blue-700">
          Actualizando saldos…
        </p>
      )}
      {error && <Notice error>{error}</Notice>}
      {success && <Notice>{success}</Notice>}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            {
              {
                general: "Una vista completa de tu cartera",
                resumen: "Tu cartera, de un vistazo",
                prestamos: "Gestiona tus préstamos",
                cobranzas: "Organiza tus cobros semanales",
                refinanciaciones: "Refinanciaciones e historial",
                historial: "Cada pago, en detalle",
                reportes: "Informes para tomar decisiones",
              }[tab]
            }
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            {tab === "resumen"
              ? "Supervisa los saldos y prioriza los cobros del día."
              : "Consulta, filtra y encuentra la información que necesitas."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={exporting || loading}
            onClick={() =>
              exportExcel(
                tab === "general"
                  ? "general"
                  : tab === "cobranzas"
                    ? "cobranzas"
                    : "todos",
              )
            }
          >
            <Download size={16} />
            {exporting ? "Generando Excel…" : "Exportar Excel completo"}
          </Button>{" "}
          <Button
            variant="outline"
            onClick={() => setRevision((r) => r + 1)}
            disabled={busy}
          >
            <RefreshCw size={16} /> Actualizar
          </Button>
        </div>
      </div>
      <Card className="!p-4">
        <div className="grid items-end gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(240px,1fr)_180px_180px]">
          <label>
            Buscar cliente / DNI / stand
            <div className="relative">
              <Search
                size={17}
                className="absolute left-3 top-3.5 text-slate-400"
                aria-hidden="true"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Nombre, DNI o stand"
                className="pl-10"
              />
            </div>
          </label>
          <label>
            Desde
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            Hasta
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
      </Card>
      {(from || to) && (
        <p className="text-xs leading-5 text-slate-500">
          El rango filtra préstamos por desembolso y pagos por fecha de pago.
          Los saldos y alertas corresponden a hoy en Lima.
        </p>
      )}
      {tab === "general" && (
        <>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-wrap gap-3">
              <label>
                Condición
                <select
                  aria-label="Filtrar condición"
                  value={memberFilter}
                  onChange={(e) => setMemberFilter(e.target.value)}
                >
                  <option value="todos">Todos</option>
                  <option value="socio">Socios</option>
                  <option value="trabajador">Trabajadores</option>
                </select>
              </label>
              <label>
                Estado
                <select
                  aria-label="Filtrar estado"
                  value={stateFilter}
                  onChange={(e) => setStateFilter(e.target.value)}
                >
                  <option value="todos">Todos</option>
                  <option value="Puntual">Puntuales</option>
                  <option value="Atrasado">Atrasados (1–6 días)</option>
                  <option value="En mora">En mora (7 días o más)</option>
                  <option value="Liquidado">Liquidados</option>
                  <option value="refinanciado">Refinanciados</option>
                </select>
              </label>
            </div>
            <Button variant="outline" onClick={exportGeneral}>
              <Download size={16} /> Exportar panel CSV
            </Button>
          </div>
          <p className="text-xs text-slate-500">
            {generalEntries.length} préstamos · Saldo: capital e intereses
            pendientes. El atraso parte de la cuota impaga más antigua.
          </p>
          <DataTable
            caption="Panel general de préstamos"
            headers={[...generalHeaders, "Detalle"]}
            keys={generalEntries.map((e) => e.loan.id)}
            rows={generalEntries.map(({ loan, client, status }) => [
              <span key="name" className="font-semibold">
                {client?.full_name ?? "Cliente no disponible"}
              </span>,
              client?.stand_code ?? "Por registrar",
              <Badge
                key="member"
                tone={client?.member_type === "socio" ? "info" : "neutral"}
              >
                {client?.member_type ?? "Por registrar"}
              </Badge>,
              status.startDate ? dateLabel(status.startDate) : "—",
              <span key="balance" className="font-semibold tabular-nums">
                {money(status.balance)}
              </span>,
              money(status.weeklyCents),
              status.nextDate ? (
                <div key="date">
                  <span className="capitalize">
                    {weekdayLabel(status.nextDate)}
                  </span>
                  <p className="mt-1 text-xs text-slate-500">
                    {dateLabel(status.nextDate)}
                  </p>
                </div>
              ) : (
                "—"
              ),
              statusBadge(loan),
              status.daysLate,
              status.refinanced ? (
                <Badge key="refinanced" tone="info">
                  Sí
                </Badge>
              ) : (
                "No"
              ),
              <Button
                key="open"
                variant="outline"
                onClick={() => setSelected(loan.id)}
              >
                Abrir
                <ChevronRight size={14} />
              </Button>,
            ])}
            emptyTitle="Sin préstamos para estos filtros"
            emptyDescription="Ajusta la búsqueda o registra un préstamo desde el módulo Préstamos."
          />
        </>
      )}
      {tab === "resumen" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              label="Capital prestado"
              value={money(totals.lent)}
              note="Capital original desembolsado"
              icon={Wallet}
            />
            <Kpi
              label="Capital pendiente"
              value={money(totals.capital)}
              note="Capital por recuperar"
              tone="purple"
              icon={CircleDollarSign}
            />
            <Kpi
              label="Total cobrado"
              value={money(totals.paid)}
              note="Capital e intereses recibidos"
              icon={Banknote}
              tone="green"
            />
            <Kpi
              label="Intereses cobrados"
              value={money(totals.interest)}
              note="Interés recibido en pagos"
              icon={TrendingUp}
              tone="green"
            />
            <Kpi
              label="Cobros del día"
              value={money(
                payments
                  .filter((p) => p.paid_on === today)
                  .reduce((n, p) => n + BigInt(p.amount_cents), 0n),
              )}
              note="Pagos registrados hoy"
              icon={CalendarDays}
              tone="green"
            />
            <Kpi
              label="Cuotas vencidas"
              value={installments.filter((i) => i.due_date < today).length}
              note="Cuotas con saldo pendiente"
              icon={Clock3}
              tone="red"
            />
            <Kpi
              label="Préstamos activos"
              value={loans.filter((l) => l.status === "activo").length}
              note="Créditos vigentes en cartera"
              icon={ArrowUpRight}
            />
            <Kpi
              label="Préstamos liquidados"
              value={loans.filter((l) => l.status === "liquidado").length}
              note="Créditos pagados en su totalidad"
              icon={CheckCircle2}
              tone="green"
            />
          </div>
          <div>
            <SectionHeading
              title="Cobros de hoy y esta semana"
              description="Identifica las cuotas pagadas, pendientes y vencidas."
              action={
                <div className="flex gap-2">
                  <Button
                    variant={agendaRange === "hoy" ? "default" : "outline"}
                    onClick={() => setAgendaRange("hoy")}
                  >
                    Hoy
                  </Button>
                  <Button
                    variant={agendaRange === "semana" ? "default" : "outline"}
                    onClick={() => setAgendaRange("semana")}
                  >
                    Esta semana
                  </Button>
                </div>
              }
            />
            {quotaTable(agenda, true)}
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            {[
              [
                "Vencen mañana",
                installments.filter((i) => i.due_date === addDays(today, 1)),
              ],
              [
                "Pendientes de esta semana",
                installments.filter(
                  (i) => i.due_date >= week.start && i.due_date <= week.end,
                ),
              ],
              [
                "Próximos vencimientos",
                installments.filter(
                  (i) => i.due_date > today && i.due_date <= addDays(today, 7),
                ),
              ],
            ].map(([title, rows]) => (
              <Card key={title as string}>
                <SectionHeading title={title as string} />
                {(rows as Installment[]).length === 0 ? (
                  <p className="text-sm text-slate-500">
                    Sin cuotas pendientes.
                  </p>
                ) : (
                  (rows as Installment[]).map((i) => (
                    <button
                      key={i.id}
                      onClick={() => setSelected(i.loan_id)}
                      className="mb-2 flex min-h-14 w-full items-center justify-between gap-3 rounded-lg border-b border-slate-100 py-3 text-left hover:bg-slate-50"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {customer(loanById(i.loan_id)!)?.full_name}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {dateLabel(i.due_date)}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold">
                        {money(i.pending_cents)}
                      </span>
                    </button>
                  ))
                )}
              </Card>
            ))}
          </div>
          <Card>
            <SectionHeading
              title="Préstamos próximos a finalizar"
              description="Periodos que terminan en los próximos siete días."
            />
            {data.periods
              .filter(
                (p) =>
                  p.is_current &&
                  p.end_date >= today &&
                  p.end_date <= addDays(today, 7) &&
                  loanById(p.loan_id)?.status === "activo" &&
                  matches(loanById(p.loan_id)!),
              )
              .map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelected(p.loan_id)}
                  className="flex min-h-11 w-full items-center justify-between gap-4 border-b border-slate-100 py-3 text-left text-sm"
                >
                  <span>{customer(loanById(p.loan_id)!)?.full_name}</span>
                  <span className="text-slate-500">
                    {dateLabel(p.end_date)}
                  </span>
                </button>
              ))}
            {!data.periods.some(
              (p) =>
                p.is_current &&
                p.end_date >= today &&
                p.end_date <= addDays(today, 7) &&
                loanById(p.loan_id)?.status === "activo" &&
                matches(loanById(p.loan_id)!),
            ) && (
              <p className="text-sm text-slate-500">
                No hay periodos por finalizar en este rango.
              </p>
            )}
          </Card>
        </>
      )}
      {tab === "prestamos" && (
        <>
          <SectionHeading
            title="Cartera de préstamos"
            description={`${loans.length} préstamos encontrados`}
            action={
              role === "administrador" && (
                <Button
                  onClick={() => {
                    setShowNew(!showNew);
                    setPreview(null);
                  }}
                >
                  <Plus size={16} /> Nuevo préstamo
                </Button>
              )
            }
          />
          {showNew && role === "administrador" && (
            <Card>
              <SectionHeading
                title="Preparar préstamo"
                description="Selecciona el producto y revisa las cuotas antes de confirmar."
                action={
                  <Button variant="outline" onClick={() => setShowNew(false)}>
                    Cancelar
                  </Button>
                }
              />
              <form
                onSubmit={prepareLoan}
                className="grid gap-5 sm:grid-cols-2"
              >
                <label>
                  Producto de préstamo
                  <select
                    aria-label="Producto de préstamo"
                    required
                    value={productId}
                    onChange={(e) => {
                      setProductId(e.target.value);
                      setPreview(null);
                    }}
                  >
                    <option value="">Selecciona un producto autorizado</option>
                    {loanProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Fecha del préstamo
                  <input
                    type="date"
                    max={today}
                    value={start}
                    onChange={(e) => {
                      setStart(e.target.value);
                      setPreview(null);
                    }}
                    required
                  />
                </label>
                <div>
                  <Button type="submit" variant="outline">
                    Revisar cronograma
                  </Button>
                </div>
              </form>
              {preview && (
                <div className="mt-6 space-y-5 border-t border-slate-100 pt-6">
                  <div className="rounded-xl bg-blue-50 p-5 text-sm leading-7">
                    Capital: {money(preview.originalCapital)} · Interés:{" "}
                    {money(preview.interestCents)} · Total:{" "}
                    <strong>{money(preview.totalCents)}</strong>
                  </div>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {preview.installments.map((i) => (
                      <li
                        key={i.number}
                        className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm"
                      >
                        Cuota {i.number} · {dateLabel(i.dueDate)} ·{" "}
                        {money(i.scheduledCents)}
                      </li>
                    ))}
                  </ul>
                  <form onSubmit={createLoan} className="space-y-4">
                    <label>
                      Cliente
                      <select name="client" required>
                        <option value="">
                          Selecciona un cliente identificado sin préstamo activo
                        </option>
                        {clients
                          .filter(
                            (c) =>
                              !activeClients.has(c.id) &&
                              c.stand_code &&
                              c.member_type,
                          )
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.full_name} · stand {c.stand_code} ·{" "}
                              {c.member_type}
                            </option>
                          ))}
                      </select>
                    </label>
                    <Button disabled={busy} type="submit">
                      {busy ? "Registrando…" : "Confirmar desembolso"}
                    </Button>
                  </form>
                </div>
              )}
            </Card>
          )}
          <DataTable
            caption="Cartera de préstamos"
            headers={[
              "Cliente",
              "Original",
              "Capital pendiente",
              "Interés pendiente",
              "Estado",
              "Detalle",
            ]}
            keys={loans.map((l) => l.id)}
            rows={loans.map((l) => [
              customerCell(l),
              money(l.original_capital),
              money(l.capital_pending),
              money(l.interest_pending),
              <PaymentBadge key="status" status={l.status} />,
              <Button
                key="open"
                variant="outline"
                onClick={() => setSelected(l.id)}
              >
                Abrir
                <ChevronRight size={14} />
              </Button>,
            ])}
            emptyTitle="Sin préstamos para estos filtros"
            emptyDescription="Selecciona Nuevo préstamo para preparar un desembolso o cambia la búsqueda."
          />
        </>
      )}
      {tab === "cobranzas" && (
        <>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <label>
              Estado de las cuotas
              <select
                value={collectionFilter}
                onChange={(e) => setCollectionFilter(e.target.value)}
              >
                <option value="pendientes">Pendientes</option>
                <option value="vencidas">Vencidas</option>
                <option value="pagadas">Pagadas</option>
                <option value="todos">Todas</option>
              </select>
            </label>
            <p className="text-sm text-slate-500">
              {collectionRows.length} cuotas · Cronograma vigente
            </p>
          </div>
          {quotaTable(collectionRows, true)}
        </>
      )}
      {tab === "refinanciaciones" && (
        <>
          <SectionHeading
            title="Préstamos para revisar"
            description="Abre el préstamo para consultar las condiciones y refinanciar cuando corresponda."
          />
          <DataTable
            caption="Préstamos activos y condiciones de refinanciación"
            headers={["Cliente", "Saldo", "Condición", "Acción"]}
            keys={loans.filter((l) => l.status === "activo").map((l) => l.id)}
            rows={loans
              .filter((l) => l.status === "activo")
              .map((l) => {
                const overdue = data.installments.some(
                  (i) =>
                    i.loan_id === l.id &&
                    i.is_current &&
                    i.due_date < today &&
                    i.pending_cents > 0,
                );
                return [
                  customerCell(l),
                  money(BigInt(l.capital_pending) + BigInt(l.interest_pending)),
                  l.interest_pending > 0 ? (
                    <Badge tone="warning">Interés pendiente</Badge>
                  ) : overdue ? (
                    <Badge tone="danger">Cuotas vencidas</Badge>
                  ) : (
                    <Badge tone="success">Revisar refinanciación</Badge>
                  ),
                  <Button
                    key="open"
                    variant="outline"
                    onClick={() => setSelected(l.id)}
                  >
                    Ver préstamo
                  </Button>,
                ];
              })}
            emptyTitle="Sin préstamos activos"
            emptyDescription="Aquí podrás revisar las condiciones de los préstamos vigentes."
          />
          <SectionHeading
            title="Historial de refinanciaciones"
            action={
              <Button
                variant="outline"
                onClick={() => exportReport("refinanciaciones")}
              >
                <Download size={16} /> Refinanciaciones CSV
              </Button>
            }
          />
          <DataTable
            caption="Historial de refinanciaciones"
            headers={[
              "Cliente",
              "Periodo",
              "Inicio",
              "Fin",
              "Capital",
              "Interés",
              "Detalle",
            ]}
            keys={refinanced.map((p) => p.id)}
            rows={refinanced.map((p) => [
              customerCell(loanById(p.loan_id)!),
              p.number,
              dateLabel(p.start_date),
              dateLabel(p.end_date),
              money(p.opening_capital),
              money(p.interest_generated),
              <Button
                key="open"
                variant="outline"
                onClick={() => setSelected(p.loan_id)}
              >
                Abrir
              </Button>,
            ])}
            emptyTitle="Todavía no hay refinanciaciones"
            emptyDescription="Los nuevos periodos aparecerán aquí después de refinanciar un préstamo."
          />
        </>
      )}
      {tab === "historial" && (
        <>
          <SectionHeading
            title="Pagos registrados"
            description={`${payments.length} pagos encontrados · Los pagos son definitivos.`}
            action={
              <Button variant="outline" onClick={() => exportReport("pagos")}>
                <Download size={16} /> Historial de pagos CSV
              </Button>
            }
          />
          <DataTable
            caption="Historial de pagos"
            headers={[
              "Cliente",
              "Fecha",
              "Total",
              "Interés",
              "Capital",
              "Estado",
              "Detalle",
            ]}
            keys={[...payments]
              .sort(
                (a, b) =>
                  b.paid_on.localeCompare(a.paid_on) ||
                  b.created_at.localeCompare(a.created_at),
              )
              .map((p) => p.id)}
            rows={[...payments]
              .sort(
                (a, b) =>
                  b.paid_on.localeCompare(a.paid_on) ||
                  b.created_at.localeCompare(a.created_at),
              )
              .map((p) => [
                customerCell(loanById(p.loan_id)!),
                dateLabel(p.paid_on),
                <span key="total" className="font-semibold">
                  {money(p.amount_cents)}
                </span>,
                money(p.interest_cents),
                money(p.capital_cents),
                <Badge key="status" tone="success">
                  Registrado
                </Badge>,
                <Button
                  key="open"
                  variant="outline"
                  onClick={() => setSelected(p.loan_id)}
                >
                  Ver préstamo
                </Button>,
              ])}
            emptyTitle="Todavía no hay pagos registrados"
            emptyDescription="Registra un pago desde el detalle del préstamo para consultar su historial."
          />
        </>
      )}
      {tab === "reportes" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[
              [
                "todos",
                "Capital pendiente",
                "Consulta el saldo de toda tu cartera.",
              ],
              ["activo", "Préstamos activos", "Revisa los créditos vigentes."],
              [
                "liquidado",
                "Créditos liquidados",
                "Consulta los préstamos pagados.",
              ],
              [
                "pagos",
                "Historial de pagos",
                "Detalle de capital e intereses recibidos.",
              ],
              [
                "vencidos",
                "Cuotas vencidas",
                "Identifica cuotas con saldo vencido.",
              ],
              [
                "refinanciaciones",
                "Refinanciaciones",
                "Consulta el historial de nuevos periodos.",
              ],
            ].map(([kind, label, description]) => (
              <Card key={kind}>
                <div className="mb-4 inline-flex rounded-xl bg-blue-50 p-2.5 text-blue-600">
                  <Download size={20} />
                </div>
                <h3 className="font-semibold">{label}</h3>
                <p className="mb-5 mt-2 text-sm leading-6 text-slate-500">
                  {description}
                </p>
                <div className="flex flex-wrap gap-2">
                  {" "}
                  <Button
                    disabled={exporting || loading}
                    onClick={() => exportExcel(kind)}
                  >
                    <Download size={16} />
                    {label} Excel
                  </Button>
                  <Button variant="outline" onClick={() => exportReport(kind)}>
                    <Download size={16} />
                    {label} CSV
                  </Button>
                </div>
              </Card>
            ))}
          </div>
          {(["semana", "mes"] as const).map((key) => (
            <div key={key}>
              <SectionHeading
                title={`Cobros por ${key}`}
                action={
                  <Button
                    variant="outline"
                    onClick={() =>
                      downloadCSV(`cobros-${key}.csv`, [
                        [key, "Cobrado PEN", "Intereses cobrados PEN"],
                        ...groups(key).map(([date, value]) => [
                          date,
                          decimalSoles(value.total),
                          decimalSoles(value.interest),
                        ]),
                      ])
                    }
                  >
                    <Download size={16} /> Exportar CSV
                  </Button>
                }
              />
              <DataTable
                caption={`Cobros por ${key}`}
                headers={["Periodo", "Total cobrado", "Intereses cobrados"]}
                keys={groups(key).map(([date]) => date)}
                rows={groups(key).map(([date, value]) => [
                  key === "semana"
                    ? dateLabel(date)
                    : new Intl.DateTimeFormat("es-PE", {
                        month: "long",
                        year: "numeric",
                        timeZone: "UTC",
                      }).format(new Date(`${date}-01T00:00:00Z`)),
                  money(value.total),
                  money(value.interest),
                ])}
                emptyTitle="Sin cobros para este periodo"
                emptyDescription="Los pagos registrados aparecerán agrupados aquí."
              />
            </div>
          ))}
        </>
      )}
      <Sheet
        open={Boolean(selectedLoan)}
        onOpenChange={(open) => {
          if (!open) setSelected("");
        }}
        title={
          selectedLoan
            ? (customer(selectedLoan)?.full_name ?? "Detalle del préstamo")
            : "Detalle del préstamo"
        }
        description="Resumen, pagos y cronograma del préstamo."
      >
        {selectedLoan && (
          <div className="space-y-6">
            {error && <Notice error>{error}</Notice>}
            {success && <Notice>{success}</Notice>}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <PaymentBadge status={selectedLoan.status} />
              {statusBadge(selectedLoan)}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ["Capital original", money(selectedLoan.original_capital)],
                ["Capital pendiente", money(selectedLoan.capital_pending)],
                ["Interés pendiente", money(selectedLoan.interest_pending)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className="mt-2 font-semibold tabular-nums">{value}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500">
              Capital amortizado:{" "}
              {money(
                selectedLoan.original_capital - selectedLoan.capital_pending,
              )}
            </p>
            {selectedLoan.status === "activo" && role === "administrador" && (
              <>
                <Card>
                  <SectionHeading
                    title="Registrar pago parcial o total"
                    description="Se aplica primero a intereses y después a capital."
                  />
                  <form onSubmit={pay} className="space-y-4">
                    <div className="rounded-xl bg-slate-50 p-4">
                      <p className="mb-3 text-xs font-semibold text-slate-600">
                        ¿Qué deseas cobrar?
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {[1, 2, 3].map((count) => (
                          <Button
                            key={count}
                            type="button"
                            variant="outline"
                            disabled={
                              busy || loading || selectedQuotas.length < count
                            }
                            onClick={() =>
                              setPaymentAmount(decimalSoles(quotaAmount(count)))
                            }
                          >
                            Pagar {count} {count === 1 ? "cuota" : "cuotas"}
                          </Button>
                        ))}
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            setPaymentAmount(
                              decimalSoles(
                                BigInt(selectedLoan.capital_pending) +
                                  BigInt(selectedLoan.interest_pending),
                              ),
                            )
                          }
                        >
                          Liquidar préstamo
                        </Button>
                      </div>
                      <p className="mt-3 text-xs leading-5 text-slate-500">
                        Las cuotas se completan desde la más antigua. Liquidar
                        incluye todo el capital y el interés pendiente. También
                        puedes ingresar un monto libre.
                      </p>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label>
                        Monto (S/)
                        <input
                          value={paymentAmount}
                          onChange={(e) => setPaymentAmount(e.target.value)}
                          required
                          inputMode="decimal"
                          placeholder="0.00"
                        />
                      </label>
                      <label>
                        Fecha de pago
                        <input
                          type="date"
                          value={paidOn}
                          onChange={(e) => setPaidOn(e.target.value)}
                          required
                          min={selectedPeriod?.start_date}
                          max={today}
                        />
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" disabled={busy}>
                        {busy ? "Registrando…" : "Confirmar pago"}
                      </Button>
                    </div>
                    <p className="text-xs leading-5 text-slate-500">
                      Los pagos son definitivos. Revisa monto y fecha antes de
                      confirmar.
                    </p>
                  </form>
                </Card>
                <details className="surface p-5">
                  <summary className="flex min-h-11 items-center justify-between gap-3 text-sm font-semibold">
                    <span>Refinanciar un mes</span>
                    <ChevronRight size={18} />
                  </summary>
                  <div className="mt-4 space-y-4 text-sm leading-6">
                    <p>
                      Misma tasa mensual {selectedLoan.rate_basis_points / 100}{" "}
                      % sobre el capital original. El nuevo periodo comienza al
                      terminar de pagar el interés anterior.
                    </p>
                    <p>
                      Inicio:{" "}
                      {selectedPeriod?.interest_settled_on
                        ? dateLabel(selectedPeriod.interest_settled_on)
                        : "Interés aún pendiente"}
                    </p>
                    {selectedLoan.interest_pending !== 0 ? (
                      <p className="rounded-lg bg-amber-50 p-3 text-amber-800">
                        Completa el pago del interés para solicitar la
                        refinanciación.
                      </p>
                    ) : data.installments.some(
                        (i) =>
                          i.loan_id === selected &&
                          i.is_current &&
                          i.due_date < today &&
                          i.pending_cents > 0,
                      ) ? (
                      <p className="rounded-lg bg-red-50 p-3 text-red-700">
                        Hay cuotas vencidas pendientes de pago.
                      </p>
                    ) : null}
                    <Button
                      disabled={
                        busy ||
                        selectedLoan.interest_pending !== 0 ||
                        data.installments.some(
                          (i) =>
                            i.loan_id === selected &&
                            i.is_current &&
                            i.due_date < today &&
                            i.pending_cents > 0,
                        )
                      }
                      onClick={() =>
                        mutate(
                          "refinance_loan",
                          { p_loan: selected },
                          "¿Refinanciar un mes con la misma tasa sobre el capital original? Se conservará el historial previo.",
                        )
                      }
                    >
                      <RefreshCw size={16} /> Confirmar refinanciación
                    </Button>
                  </div>
                </details>
              </>
            )}
            <div>
              <SectionHeading
                title="Historial de periodos y cuotas"
                description="Se conservan las fechas y los cronogramas originales."
              />
              {data.periods
                .filter((p) => p.loan_id === selected)
                .sort((a, b) => a.number - b.number)
                .map((p) => (
                  <div key={p.id} className="mb-6 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">
                        Periodo {p.number} · {dateLabel(p.start_date)} –{" "}
                        {dateLabel(p.end_date)}
                      </h3>
                      <Badge tone={p.is_current ? "info" : "neutral"}>
                        {p.is_current ? "Vigente" : "Histórico"}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-500">
                      Interés generado: {money(p.interest_generated)}
                    </p>
                    <DataTable
                      caption={`Cuotas del periodo ${p.number}`}
                      headers={[
                        "Cuota",
                        "Fecha original",
                        "Programado",
                        "Pagado",
                        "Saldo",
                        "Estado",
                      ]}
                      keys={data.installments
                        .filter((i) => i.period_id === p.id)
                        .sort((a, b) => a.number - b.number)
                        .map((i) => i.id)}
                      rows={data.installments
                        .filter((i) => i.period_id === p.id)
                        .sort((a, b) => a.number - b.number)
                        .map((i) => [
                          i.number,
                          dateLabel(i.due_date),
                          money(i.scheduled_cents),
                          money(i.paid_cents),
                          money(i.pending_cents),
                          p.is_current ? (
                            quotaBadge(i)
                          ) : (
                            <Badge key="historic">Histórico</Badge>
                          ),
                        ])}
                    />
                    {!p.is_current && (
                      <p className="text-xs leading-5 text-slate-500">
                        El saldo histórico se trasladó al nuevo periodo; no se
                        suma de nuevo a la deuda vigente.
                      </p>
                    )}
                  </div>
                ))}
            </div>
            <div>
              <SectionHeading title="Pagos registrados" />
              <DataTable
                caption="Pagos de este préstamo"
                headers={["Fecha", "Total", "Interés", "Capital"]}
                keys={data.payments
                  .filter((p) => p.loan_id === selected)
                  .sort((a, b) => a.created_at.localeCompare(b.created_at))
                  .map((p) => p.id)}
                rows={data.payments
                  .filter((p) => p.loan_id === selected)
                  .sort((a, b) => a.created_at.localeCompare(b.created_at))
                  .map((p) => [
                    dateLabel(p.paid_on),
                    money(p.amount_cents),
                    money(p.interest_cents),
                    money(p.capital_cents),
                  ])}
                emptyTitle="Aún no hay pagos"
                emptyDescription="El historial se actualizará al registrar un pago."
              />
            </div>
          </div>
        )}
      </Sheet>
    </section>
  );
}
