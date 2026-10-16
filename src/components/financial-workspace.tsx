"use client";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useLiveRevision } from "@/hooks/use-live-revision";
import { getSupabase } from "@/lib/supabase";
import {
  cents,
  decimalSoles,
  formatPEN,
  monthlyRateForCapital,
  requireApprovedProduct,
  scheduleLoan,
  scheduleRefinancing,
  requireRefinancingPrerequisites,
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
  CircleDollarSign,
  Banknote,
  CalendarDays,
  Clock3,
  ChevronRight,
} from "lucide-react";
import {
  Badge,
  Card,
  ClientSearch,
  DataTable,
  Kpi,
  LoadingSkeleton,
  Notice,
  PaymentBadge,
  SectionHeading,
  Sheet,
} from "@/components/ui/dashboard";
export type FinancialView =
  "general" | "resumen" | "prestamos" | "refinanciaciones" | "reportes";
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
  const [hasData, setHasData] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [revision, setRevision] = useState(0);
  const liveRevision = useLiveRevision();
  const tab = view === "prestamos" ? "general" : view;
  const [success, setSuccess] = useState("");
  const [agendaRange, setAgendaRange] = useState<"hoy" | "semana" | "vencidos" | "proximos">("hoy");
  const [stateFilter, setStateFilter] = useState("todos");
  const [memberFilter, setMemberFilter] = useState("todos");
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState("");
  const [refinanceDraft, setRefinanceDraft] = useState<{ key: string; start: string; months: 1 | 2 } | null>(null);
  const [loanAmount, setLoanAmount] = useState("");
  const [loanMonths, setLoanMonths] = useState<1 | 2>(1);
  let displayedRate: number | null = null;
  try { displayedRate = monthlyRateForCapital(cents(loanAmount)); } catch { /* The form explains validation on submit. */ }
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
        if (active) {
          setData({
            loans: loans as Loan[],
            periods: periods as Period[],
            payments: payments as Payment[],
            installments: installments as Installment[],
          });
          setHasData(true);
        }
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
  }, [revision, liveRevision]);
  const clientsById = useMemo(() => new Map(clients.map(client => [client.id, client])), [clients]);
  const loansById = useMemo(() => new Map(data.loans.map(loan => [loan.id, loan])), [data.loans]);
  const currentPeriodsByLoan = useMemo(() => new Map(data.periods.filter(period => period.is_current).map(period => [period.loan_id, period])), [data.periods]);
  const customer = (loan: Loan) => clientsById.get(loan.client_id);
  const current = (loanId: string) => currentPeriodsByLoan.get(loanId);
  const loanById = (id: string) => loansById.get(id);
  function refinancingBlock(loan: Loan) {
    const period = current(loan.id);
    if (loan.status !== "activo" || loan.capital_pending <= 0) return "Préstamo liquidado";
    if (!period) return "No se encontró el periodo vigente";
    try {
      requireRefinancingPrerequisites(loan.interest_pending, period.end_date, today);
      if (!period.interest_settled_on) return "Falta confirmar el pago completo del interés";
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : "No se pudo verificar la refinanciación";
    }
  }

  const matches = (loan: Loan) =>
    (!clientFocus || loan.client_id === clientFocus) &&
    `${customer(loan)?.full_name ?? ""} ${customer(loan)?.dni ?? ""} ${customer(loan)?.stand_code ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase());
  const loans = data.loans.filter(matches);
  const payments = data.payments.filter((p) =>
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
  const selectedClient = selectedLoan ? customer(selectedLoan) : undefined;
  const selectedStatus = selectedLoan
    ? collectionStatus(selectedLoan, data.periods, data.installments, today)
    : undefined;
  const selectedPeriod = current(selected);
  const refinanceKey = `${selected}:${selectedPeriod?.id ?? ""}`;
  const refinanceStart = refinanceDraft?.key === refinanceKey ? refinanceDraft.start : selectedPeriod ? addDays(selectedPeriod.end_date, 1) : "";
  const refinanceMonths = refinanceDraft?.key === refinanceKey ? refinanceDraft.months : 1;
  let refinancePreview: ReturnType<typeof scheduleRefinancing> | null = null;
  let refinanceError = selectedLoan ? refinancingBlock(selectedLoan) : "";
  if (selectedLoan && selectedPeriod && !refinanceError) {
    try {
      refinancePreview = scheduleRefinancing({ originalCapital: selectedLoan.original_capital, pendingCapital: selectedLoan.capital_pending, pendingInterest: selectedLoan.interest_pending, currentPeriodEndDate: selectedPeriod.end_date, asOfDate: today, existingRateBasisPoints: selectedLoan.rate_basis_points, interestSettlementDate: selectedPeriod.interest_settled_on!, startDate: refinanceStart, months: refinanceMonths });
    } catch (error) { refinanceError = error instanceof Error ? error.message : "Revisa fecha y plazo de refinanciación"; }
  }

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
      const message = e instanceof Error ? e.message : "No se pudo completar la operación. Puedes reintentar con los mismos datos.";
      setError(/cuotas vencidas pendientes|producto de préstamo no autorizado/i.test(message) || (name === "refinance_loan" && /could not find.*function|schema cache/i.test(message))
        ? "Actualización de Supabase pendiente: la base de datos conserva las reglas anteriores. Aplica la actualización 007 y vuelve a intentarlo."
        : message);
    } finally {
      mutationLock.current = false;
      setBusy(false);
    }
  }
  function prepareLoan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      const capital = cents(loanAmount);
      const rate = monthlyRateForCapital(capital);
      requireApprovedProduct(capital, rate, loanMonths);
      setPreview(scheduleLoan(capital, rate, loanMonths, start));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Datos inválidos.");
    }
  }
  async function createLoan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview) return;
    const fields = new FormData(event.currentTarget);
    await mutate(
      "create_loan",
      {
        p_client: String(fields.get("client")),
        p_capital: preview.originalCapital,
        p_rate: monthlyRateForCapital(preview.originalCapital),
        p_months: loanMonths,
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
          .filter((i) => i.due_date < today)
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
    )
    .sort(
      (a, b) =>
        Number(a.status.state === "Liquidado") -
          Number(b.status.state === "Liquidado") ||
        Number(b.status.requiresSettlement) -
          Number(a.status.requiresSettlement) ||
        b.status.daysLate - a.status.daysLate ||
        (a.status.nextDate ?? "9999-12-31").localeCompare(
          b.status.nextDate ?? "9999-12-31",
        ) ||
        (a.client?.full_name ?? "").localeCompare(
          b.client?.full_name ?? "",
          "es",
        ),
    );
  const dueToday = (loanId: string) =>
    data.installments.some(
      (i) =>
        i.loan_id === loanId &&
        i.is_current &&
        i.pending_cents > 0 &&
        i.due_date === today,
    );
  const generalExportHeaders = [
    "Nombres y apellidos",
    "Código stand",
    "Condición",
    "Fecha del préstamo",
    "N.º de cuotas",
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
        : agendaRange === "semana"
          ? i.due_date >= week.start && i.due_date <= week.end
          : agendaRange === "vencidos"
            ? i.pending_cents > 0 && i.due_date < today
            : i.pending_cents > 0 && i.due_date > today && i.due_date <= addDays(today, 7),
    )
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  const refinanced = data.periods
    .filter(
      (p) =>
        p.number > 1 &&
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
          ["En mora", "Liquidación urgente"].includes(status.state)
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
    const loan = loanById(i.loan_id);
    if (
      i.is_current &&
      i.pending_cents > 0 &&
      loan &&
      collectionStatus(loan, data.periods, data.installments, today)
        .requiresSettlement
    )
      return <Badge tone="danger">Liquidación urgente</Badge>;

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
  function portfolioFilters() {
    return (
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
                  <option value="Liquidación urgente">
                    Liquidación urgente
                  </option>
                  <option value="Puntual">Puntuales</option>
                  <option value="Atrasado">Atrasados (1–6 días)</option>
                  <option value="En mora">En mora (7 días o más)</option>
                  <option value="Liquidado">Liquidados</option>
                  <option value="refinanciado">Refinanciados</option>
                </select>
              </label>
            </div>
    );
  }
  function exportGeneral() {
    downloadCSV("panel-general.csv", [
      generalExportHeaders,
      ...generalEntries.map(({ client, status }) => [
        client?.full_name ?? "",
        client?.stand_code ?? "Por registrar",
        client?.member_type ?? "Por registrar",
        status.startDate ?? "",
        status.originalInstallments ?? "",
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
      if (kind === "pagos") selectedIds = payments.map((p) => p.loan_id);
      if (kind === "vencidos")
        selectedIds = installments
          .filter((i) => i.due_date < today)
          .map((i) => i.loan_id);
      if (kind === "refinanciaciones")
        selectedIds = refinanced.map((p) => p.loan_id);
      await downloadCreditWorkbook(
        {
          clients,
          ...data,
          today,
          selectedLoanIds: [...new Set(selectedIds)],
          description: `Selección: ${kind}. Búsqueda: ${search || "todos"}. Incluye el historial completo de los préstamos seleccionados.`,
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
  if (loading && !hasData) return <LoadingSkeleton />;
  return (
    <section className="space-y-6" aria-busy={loading}>
      {loading && (
        <p role="status" className="sr-only">
          Actualizando saldos…
        </p>
      )}
      {error && <Notice error>{error}{error.startsWith("Actualización de Supabase pendiente") && <p className="mt-2"><a className="font-semibold underline" href="https://github.com/AntonyParedes/PLAZA-MOVIL/blob/mejora/experiencia-navegacion/supabase/migrations/202610150007_refinance_date_and_term.sql" target="_blank" rel="noreferrer">Abrir actualización SQL 007</a></p>}</Notice>}
      {success && <Notice>{success}</Notice>}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            {
              {
                general: "Tu cobranza semanal",
                resumen: "Tu cartera, de un vistazo",
                prestamos: "Gestiona tus préstamos",
                refinanciaciones: "Refinanciaciones e historial",
                reportes: "Informes para tomar decisiones",
              }[tab]
            }
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            {tab === "resumen"
              ? "Supervisa los saldos y prioriza los cobros del día."
              : tab === "general"
                ? "Identifica quién debe pagar y abre su nombre para enviar un recordatorio."
                : tab === "refinanciaciones"
                    ? "Revisa las condiciones y consulta los periodos refinanciados."
                    : "Descarga la información completa de tu cartera y movimientos."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {tab === "reportes" && <Button
            disabled={exporting || loading}
            onClick={() => exportExcel("todos")}
          >
            <Download size={16} />
            {exporting ? "Generando Excel…" : "Exportar Excel completo"}
          </Button>}
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
        <div className="max-w-xl">
          <ClientSearch value={search} onChange={setSearch} />
        </div>
      </Card>
      {tab === "general" && (
        <>
          {view === "prestamos" && <SectionHeading title="Cartera de préstamos" description="Saldo, cuota semanal y estado de cada prestatario." action={role === "administrador" && <Button onClick={() => { setShowNew(!showNew); setPreview(null); }}><Plus size={16} /> Nuevo préstamo</Button>} />}
          {view === "prestamos" && showNew && role === "administrador" && (
            <Card>
              <SectionHeading
                title="Preparar préstamo"
                description="Ingresa el monto y el plazo; la tasa se calcula automáticamente."
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
                  Monto del préstamo (S/)
                  <input type="number" min="0.01" step="0.01" inputMode="decimal" required value={loanAmount} onChange={event => { setLoanAmount(event.target.value); setPreview(null); }} placeholder="Ej. 1500.00" />
                </label>
                <label>
                  Plazo del préstamo
                  <select aria-label="Plazo del préstamo" value={loanMonths} onChange={event => { setLoanMonths(Number(event.target.value) as 1 | 2); setPreview(null); }}>
                    <option value="1">1 mes · 4 cuotas semanales</option>
                    <option value="2">2 meses · 8 cuotas semanales</option>
                  </select>
                </label>
                <div className="rounded-xl bg-blue-50 p-4 text-sm text-blue-700" role="status">
                  Tasa mensual: <strong>{displayedRate === null ? "Ingresa un monto mayor que cero" : `${displayedRate / 100} %`}</strong>
                  <p className="mt-1 text-xs">Hasta S/500: 7 % mensual. Más de S/500: 6 % mensual.</p>
                </div>
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
          <div className="flex flex-wrap items-end justify-between gap-4">
            {portfolioFilters()}

          </div>
          <p className="text-xs text-slate-500">
            {generalEntries.length} préstamos · Saldo: capital e intereses
            pendientes. Primero aparecen los atrasados. Pulsa un nombre para ver
            detalles y enviar un recordatorio.
          </p>
          <DataTable
            caption="Panel general de préstamos"
            headers={[
              "Prestatario",
              "Fecha del préstamo",
              "N.º de cuotas",
              "Día de pago",
              "Saldo",
              "Cuota semanal",
              "Estado",
            ]}
            keys={generalEntries.map((e) => e.loan.id)}
            rowClassNames={generalEntries.map((e) =>
              dueToday(e.loan.id) ? "payment-due-today" : "",
            )}
            rows={generalEntries.map(({ loan, client, status }) => {
              const paymentDate =
                status.nextDate ??
                data.installments.find(
                  (i) => i.loan_id === loan.id && i.is_current,
                )?.due_date;
              return [
                <button
                  key="name"
                  type="button"
                  aria-label={`Ver detalle de ${client?.full_name ?? "prestatario"}`}
                  onClick={() => setSelected(loan.id)}
                  className="min-h-11 rounded-lg border-l-4 px-3 text-left font-semibold text-slate-900 hover:bg-slate-50"
                  style={{
                    borderColor: ["En mora", "Liquidación urgente"].includes(
                      status.state,
                    )
                      ? "var(--danger-text)"
                      : status.state === "Atrasado"
                        ? "var(--warning-text)"
                        : "var(--success-text)",
                  }}
                >
                  {client?.full_name ?? "Cliente no disponible"}
                </button>,
                status.startDate ? dateLabel(status.startDate) : "—",
                status.originalInstallments ?? "—",
                <div key="day" className="space-y-2">
                  <span className="capitalize">
                    {paymentDate ? weekdayLabel(paymentDate) : "—"}
                  </span>
                  {dueToday(loan.id) && (
                    <span className="block">
                      <span className="inline-flex rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-text)]">
                        Vence hoy
                      </span>
                    </span>
                  )}
                </div>,
                <span key="balance" className="font-semibold tabular-nums">
                  {money(status.balance)}
                </span>,
                money(status.weeklyCents),
                statusBadge(loan),
              ];
            })}
            emptyTitle="Sin préstamos para estos filtros"
            emptyDescription="Ajusta la búsqueda o registra un préstamo desde el módulo Préstamos."
          />
        </>
      )}
      {tab === "resumen" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
          </div>
          <div>
            <SectionHeading
              title="Cobros de hoy y esta semana"
              description="Identifica las cuotas pagadas, pendientes y vencidas."
              action={
                <div className="flex flex-wrap gap-2">
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
                  <Button variant={agendaRange === "vencidos" ? "default" : "outline"} onClick={() => setAgendaRange("vencidos")}>Vencidos</Button>
                  <Button variant={agendaRange === "proximos" ? "default" : "outline"} onClick={() => setAgendaRange("proximos")}>Próximos 7 días</Button>
                </div>
              }
            />
            {quotaTable(agenda, true)}
          </div>
          <details className="surface p-4">
            <summary className="min-h-11 font-semibold text-sm">Más indicadores de cartera</summary>
            <dl className="grid gap-4 pt-3 sm:grid-cols-2 lg:grid-cols-4">
              {[["Capital prestado", money(totals.lent)], ["Intereses cobrados", money(totals.interest)], ["Préstamos activos", loans.filter(l => l.status === "activo").length], ["Préstamos liquidados", loans.filter(l => l.status === "liquidado").length]].map(([label, value]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 font-semibold tabular-nums">{value}</dd></div>)}
            </dl>
          </details>
          <details className="surface p-4">
            <summary className="min-h-11 text-sm font-semibold">Préstamos próximos a finalizar</summary>
            <p className="mb-3 text-xs text-slate-500">Periodos que terminan en los próximos siete días.</p>
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
          </details>
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
                const block = refinancingBlock(l);
                return [
                  customerCell(l),
                  money(BigInt(l.capital_pending) + BigInt(l.interest_pending)),
                  block ? (
                    <Badge tone="warning">{l.interest_pending > 0 ? "Interés pendiente" : block.includes("periodo aún") ? "Periodo vigente" : "No disponible"}</Badge>
                  ) : (
                    <Badge tone="success">Puede refinanciar</Badge>
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
              <span className="text-xs text-slate-500">Exportación disponible en Reportes</span>
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
      {tab === "reportes" && (
        <>
          <Card>
            <SectionHeading title="Panel de cobranza" description="Exporta el resumen de prestatarios, saldos, cuotas y estados." action={<div className="flex flex-wrap gap-2"><Button disabled={loading || exporting} onClick={() => exportExcel("general")}><Download size={16} /> Panel de cobranza Excel</Button><Button variant="outline" onClick={exportGeneral}><Download size={16} /> Exportar panel CSV</Button></div>} />
            {portfolioFilters()}
          </Card>
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
            {error && <Notice error>{error}{error.startsWith("Actualización de Supabase pendiente") && <p className="mt-2"><a className="font-semibold underline" href="https://github.com/AntonyParedes/PLAZA-MOVIL/blob/mejora/experiencia-navegacion/supabase/migrations/202610150007_refinance_date_and_term.sql" target="_blank" rel="noreferrer">Abrir actualización SQL 007</a></p>}</Notice>}
            {success && <Notice>{success}</Notice>}
            {selectedStatus?.requiresSettlement && (
              <Notice error>
                El plazo terminó el {dateLabel(selectedStatus.termEndDate!)}.
                Saldo: {money(selectedStatus.balance)}. Puedes liquidar el préstamo
                o refinanciarlo cuando el interés esté completamente pagado.
              </Notice>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <PaymentBadge status={selectedLoan.status} />
              {statusBadge(selectedLoan)}
            </div>
            <dl className="grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm sm:grid-cols-2">
              {[
                ["Código stand", selectedClient?.stand_code ?? "Por registrar"],
                ["Condición", selectedClient?.member_type ?? "Por registrar"],
                ["DNI", selectedClient?.dni ?? "—"],
                ["Celular", selectedClient?.phone ?? "—"],
                [
                  "Fecha del préstamo",
                  selectedStatus?.startDate
                    ? dateLabel(selectedStatus.startDate)
                    : "—",
                ],
                [
                  "Cuota pendiente vence",
                  selectedStatus?.nextDate
                    ? dateLabel(selectedStatus.nextDate)
                    : "Sin cuotas pendientes",
                ],
                [
                  "Fin del plazo",
                  selectedStatus?.termEndDate
                    ? dateLabel(selectedStatus.termEndDate)
                    : "—",
                ],
                ["Días de atraso", String(selectedStatus?.daysLate ?? 0)],
                ["Refinanciado", selectedStatus?.refinanced ? "Sí" : "No"],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-slate-500">{label}</dt>
                  <dd className="mt-1 font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            {selectedClient &&
              selectedQuotas[0] &&
              /^9\d{8}$/.test(selectedClient.phone) && (
                <a
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--brand-border)] bg-[var(--brand-soft)] px-4 text-sm font-semibold text-[var(--brand-text)]"
                  href={`https://wa.me/51${selectedClient.phone}?text=${encodeURIComponent(whatsappReminder(selectedClient, selectedLoan, selectedQuotas[0], data.periods, data.installments, today))}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MessageCircle size={18} /> Recordar pago por WhatsApp
                </a>
              )}
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
                    <span>Refinanciar préstamo</span>
                    <ChevronRight size={18} />
                  </summary>
                  <div className="mt-4 space-y-4 text-sm leading-6">
                    <p>Misma tasa mensual {selectedLoan.rate_basis_points / 100} % sobre el capital original. El interés anterior debe estar pagado y el periodo terminado.</p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label>Fecha de refinanciación
                        <input type="date" required value={refinanceStart} min={selectedPeriod ? addDays(selectedPeriod.end_date, 1) : undefined} max={today} disabled={busy} onChange={event => setRefinanceDraft({ key: refinanceKey, start: event.target.value, months: refinanceMonths })} />
                      </label>
                      <label>Plazo de refinanciación
                        <select aria-label="Plazo de refinanciación" value={refinanceMonths} disabled={busy} onChange={event => setRefinanceDraft({ key: refinanceKey, start: refinanceStart, months: Number(event.target.value) as 1 | 2 })}>
                          <option value="1">1 mes · 4 cuotas semanales</option>
                          <option value="2">2 meses · 8 cuotas semanales</option>
                        </select>
                      </label>
                    </div>
                    {refinanceError && <p className="rounded-lg bg-amber-50 p-3 text-amber-800">{refinanceError}</p>}
                    {refinancePreview && <div className="space-y-3 rounded-xl bg-blue-50 p-4">
                      <p>Inicio: {dateLabel(refinancePreview.startDate)} · Fin: {dateLabel(refinancePreview.endDate)}</p>
                      <p>Capital pendiente: {money(refinancePreview.pendingCapital)} · Nuevo interés: {money(refinancePreview.interestCents)} · Total: <strong>{money(refinancePreview.totalCents)}</strong></p>
                      <ul className="grid gap-2 sm:grid-cols-2">{refinancePreview.installments.map(quota => <li key={quota.number}>Cuota {quota.number} · {dateLabel(quota.dueDate)} · {money(quota.scheduledCents)}</li>)}</ul>
                    </div>}
                    <Button
                      disabled={busy || Boolean(refinanceError) || !refinancePreview}
                      onClick={() => refinancePreview && mutate("refinance_loan", { p_loan: selected, p_start: refinancePreview.startDate, p_months: refinancePreview.months }, `¿Refinanciar por ${refinancePreview.months} mes(es), del ${dateLabel(refinancePreview.startDate)} al ${dateLabel(refinancePreview.endDate)}, con interés de ${money(refinancePreview.interestCents)} y total de ${money(refinancePreview.totalCents)}? Se conservará el historial previo.`)}
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
