import type { CellValue, Worksheet } from "exceljs";
import { decimalSoles } from "./finance";
import { collectionStatus, weekdayLabel } from "./collection-status";
import {
  weekBounds,
  type Customer,
  type Loan,
  type Period,
  type Payment,
  type Installment,
} from "./portal";

export type CreditExportData = {
  clients: (Customer & {
    address?: string;
    notes?: string | null;
    created_at?: string;
  })[];
  loans: Loan[];
  periods: Period[];
  payments: Payment[];
  installments: Installment[];
  today: string;
  selectedLoanIds?: string[];
  description?: string;
};
type Column = {
  title: string;
  width?: number;
  format?: string;
  color?: string;
};
const currency = '"S/" #,##0.00';
const date = (value: string | null | undefined): CellValue =>
  value ? new Date(`${value.slice(0, 10)}T00:00:00Z`) : null;
// Excel retains only 15 significant digits. Keep larger amounts as exact decimal text.
export function excelMoney(value: number | bigint): number | string {
  const integer = BigInt(value);
  return integer.toString().length > 15
    ? decimalSoles(integer)
    : Number(integer) / 100;
}
function setupSheet(sheet: Worksheet, columns: Column[], rows: CellValue[][]) {
  sheet.columns = columns.map((c) => ({
    header: c.title,
    width: c.width ?? 18,
    style: { numFmt: c.format ?? "General" },
  }));
  sheet.addRows(rows);
  sheet.views = [
    { state: "frozen", xSplit: Math.min(3, columns.length), ySplit: 1 },
  ];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, sheet.rowCount), column: columns.length },
  };
  sheet.getRow(1).height = 42;
  sheet.getRow(1).eachCell((cell, index) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: columns[index - 1].color ?? "FFE8EDF4" },
    };
    cell.font = {
      name: "Calibri",
      size: 10,
      bold: true,
      color: { argb: "FF17213A" },
    };
    cell.alignment = {
      vertical: "middle",
      horizontal: "center",
      wrapText: true,
    };
  });
  for (let number = 2; number <= sheet.rowCount; number++) {
    const row = sheet.getRow(number);
    row.height = 24;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: "Calibri", size: 11 };
      cell.alignment = { vertical: "middle" };
      cell.border = {
        top: { style: "hair", color: { argb: "FFDCE2EB" } },
        bottom: { style: "hair", color: { argb: "FFDCE2EB" } },
        left: { style: "hair", color: { argb: "FFDCE2EB" } },
        right: { style: "hair", color: { argb: "FFDCE2EB" } },
      };
    });
  }
  sheet.pageSetup = {
    orientation: "landscape",
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: "1:1",
  };
}
export async function buildCreditWorkbook(input: CreditExportData) {
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  book.creator = "PM Créditos";
  book.title = "Cartera y cobros de PM Créditos";
  book.description =
    input.description ?? "Información completa de préstamos y cobros";
  const clients = new Map(input.clients.map((c) => [c.id, c]));
  const startDate = (loan: Loan) =>
    input.periods.find((p) => p.loan_id === loan.id && p.number === 1)
      ?.start_date ?? loan.created_at.slice(0, 10);
  const allLoans = [...input.loans].sort(
    (a, b) =>
      startDate(a).localeCompare(startDate(b)) || a.id.localeCompare(b.id),
  );
  const numbering = new Map(allLoans.map((l, index) => [l.id, index + 1]));
  const selection = input.selectedLoanIds
    ? new Set(input.selectedLoanIds)
    : null;
  const loans = allLoans.filter((l) => !selection || selection.has(l.id));
  const ids = new Set(loans.map((l) => l.id));
  const periods = input.periods
    .filter((p) => ids.has(p.loan_id))
    .sort((a, b) => a.loan_id.localeCompare(b.loan_id) || a.number - b.number);
  const installments = input.installments
    .filter((i) => ids.has(i.loan_id))
    .sort(
      (a, b) =>
        a.loan_id.localeCompare(b.loan_id) ||
        a.period_id.localeCompare(b.period_id) ||
        a.number - b.number,
    );
  const payments = input.payments
    .filter((p) => ids.has(p.loan_id))
    .sort(
      (a, b) =>
        a.paid_on.localeCompare(b.paid_on) ||
        a.created_at.localeCompare(b.created_at) ||
        a.id.localeCompare(b.id),
    );
  const loanMap = new Map(loans.map((l) => [l.id, l]));
  const periodMap = new Map(periods.map((p) => [p.id, p]));
  const rowStatus = (i: Installment) =>
    !i.is_current
      ? "Histórico"
      : i.pending_cents === 0
        ? "Pagado"
        : i.due_date < input.today
          ? "Vencido"
          : i.paid_cents > 0
            ? "Pago parcial"
            : "Pendiente";
  const name = (loanId: string) =>
    clients.get(loanMap.get(loanId)!.client_id)?.full_name ??
    "Cliente no disponible";
  const moneyColumn = (title: string, color?: string): Column => ({
    title,
    format: currency,
    width: 18,
    color,
  });
  const dateColumn = (title: string): Column => ({
    title,
    format: "dd/mm/yyyy",
    width: 15,
  });
  const quotaCount = Math.max(
    8,
    ...loans.map(
      (l) =>
        installments.filter((i) => i.loan_id === l.id && i.is_current).length,
    ),
  );
  const columns: Column[] = [
    { title: "CONDICIÓN", width: 16 },
    { title: "N° PRÉSTAMO", width: 12, color: "FFF2F7CC" },
    { title: "CÓDIGO STAND", width: 14, format: "@", color: "FFF2F7CC" },
    dateColumn("FECHA"),
    { title: "CELULAR", width: 15, format: "@" },
    { title: "APELLIDOS Y NOMBRES", width: 34, color: "FFFCE4D6" },
    { title: "DNI", width: 14, format: "@" },
    moneyColumn("MONTO PRESTADO", "FFD9EEDD"),
    { title: "INTERÉS INICIAL (%)", format: "0.00%", color: "FFD9EEDD" },
    moneyColumn("TOTAL A COBRAR", "FFD9EEDD"),
    moneyColumn("CUOTA SEMANAL", "FFD9EEDD"),
    ...Array.from({ length: quotaCount }, (_, index) =>
      moneyColumn(`CUOTA ${index + 1}`, "FFEBDCF1"),
    ),
    moneyColumn("SALDO", "FFD9E8F5"),
    { title: "ESTADO", width: 25, color: "FFD9E8F5" },
    { title: "N° CUOTAS", width: 12 },
    { title: "DÍA DE PAGO", width: 16 },
    dateColumn("FECHA PRÓXIMA CUOTA"),
    { title: "DÍAS DE ATRASO", width: 15 },
    { title: "REFINANCIADO", width: 16 },
    { title: "PERIODO VIGENTE", width: 16 },
    { title: "TASA MENSUAL (%)", format: "0.00%" },
    moneyColumn("INTERÉS GENERADO"),
    moneyColumn("TOTAL PAGADO"),
    moneyColumn("CAPITAL PENDIENTE"),
    moneyColumn("INTERÉS PENDIENTE"),
    { title: "ID PRÉSTAMO", width: 38, format: "@" },
  ];
  const cartera = book.addWorksheet("Cartera");
  setupSheet(
    cartera,
    columns,
    loans.map((l) => {
      const c = clients.get(l.client_id);
      const status = collectionStatus(l, periods, installments, input.today);
      const original = periods.find(
        (p) => p.loan_id === l.id && p.number === 1,
      );
      const current = periods.find((p) => p.loan_id === l.id && p.is_current);
      const schedule = installments
        .filter((i) => i.loan_id === l.id && i.is_current)
        .sort((a, b) => a.number - b.number);
      const generated = periods
        .filter((p) => p.loan_id === l.id)
        .reduce((sum, p) => sum + BigInt(p.interest_generated), 0n);
      const paid = payments
        .filter((p) => p.loan_id === l.id)
        .reduce((sum, p) => sum + BigInt(p.amount_cents), 0n);
      const firstDue = schedule[0]?.due_date;
      return [
        c?.member_type?.toUpperCase() ?? "Por registrar",
        numbering.get(l.id)!,
        c?.stand_code ?? "Por registrar",
        date(startDate(l)),
        c?.phone ?? "",
        c?.full_name ?? "Cliente no disponible",
        c?.dni ?? "",
        excelMoney(l.original_capital),
        (l.rate_basis_points * (original?.months ?? 1)) / 10000,
        excelMoney(BigInt(l.original_capital) + generated),
        excelMoney(
          status.nextDate
            ? status.weeklyCents
            : (schedule[0]?.scheduled_cents ?? 0),
        ),
        ...Array.from({ length: quotaCount }, (_, index) => {
          const i = schedule.find((i) => i.number === index + 1);
          return i ? excelMoney(i.paid_cents) : null;
        }),
        excelMoney(status.balance),
        status.state === "Atrasado"
          ? `Se atrasó ${status.daysLate} ${status.daysLate === 1 ? "día" : "días"}`
          : status.state,
        schedule.length,
        firstDue ? weekdayLabel(firstDue) : "",
        date(status.nextDate),
        status.daysLate,
        status.refinanced ? "Sí" : "No",
        current?.number ?? null,
        l.rate_basis_points / 10000,
        excelMoney(generated),
        excelMoney(paid),
        excelMoney(l.capital_pending),
        excelMoney(l.interest_pending),
        l.id,
      ];
    }),
  );
  loans.forEach((l, index) => {
    const schedule = installments.filter(
      (i) => i.loan_id === l.id && i.is_current,
    );
    schedule.forEach((i) => {
      const cell = cartera.getRow(index + 2).getCell(11 + i.number);
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: {
          argb:
            i.pending_cents === 0
              ? "FFD9EEDD"
              : i.due_date < input.today
                ? "FFFADBD8"
                : i.paid_cents > 0
                  ? "FFFCE7BD"
                  : "FFFFF5D6",
        },
      };
    });
    cartera.getRow(index + 2).getCell(6).font = {
      name: "Calibri",
      size: 11,
      bold: true,
    };
  });
  const common: Column[] = [
    { title: "N° PRÉSTAMO", width: 12 },
    { title: "CLIENTE", width: 34 },
    { title: "CÓDIGO STAND", width: 14, format: "@" },
  ];
  const identity = (loanId: string): CellValue[] => [
    numbering.get(loanId)!,
    name(loanId),
    clients.get(loanMap.get(loanId)!.client_id)?.stand_code ?? "Por registrar",
  ];
  setupSheet(
    book.addWorksheet("Cuotas"),
    [
      ...common,
      { title: "PERIODO" },
      { title: "VIGENTE / HISTÓRICO" },
      { title: "CUOTA" },
      dateColumn("VENCIMIENTO"),
      moneyColumn("PROGRAMADO"),
      moneyColumn("PAGADO"),
      moneyColumn("SALDO"),
      { title: "ESTADO" },
      { title: "DÍAS DE ATRASO" },
      { title: "ID CUOTA", width: 38 },
      { title: "ID PERIODO", width: 38 },
      { title: "ID PRÉSTAMO", width: 38 },
    ],
    installments.map((i) => [
      ...identity(i.loan_id),
      periodMap.get(i.period_id)?.number ?? null,
      i.is_current ? "Vigente" : "Histórico",
      i.number,
      date(i.due_date),
      excelMoney(i.scheduled_cents),
      excelMoney(i.paid_cents),
      excelMoney(i.pending_cents),
      rowStatus(i),
      i.is_current && i.pending_cents > 0
        ? Math.max(
            0,
            Math.floor(
              (Date.parse(`${input.today}T00:00:00Z`) -
                Date.parse(`${i.due_date}T00:00:00Z`)) /
                86400000,
            ),
          )
        : 0,
      i.id,
      i.period_id,
      i.loan_id,
    ]),
  );
  setupSheet(
    book.addWorksheet("Pagos"),
    [
      ...common,
      { title: "PERIODO" },
      dateColumn("FECHA DE PAGO"),
      moneyColumn("TOTAL PAGADO"),
      moneyColumn("INTERÉS"),
      moneyColumn("CAPITAL"),
      { title: "REGISTRO (LIMA)", width: 24 },
      { title: "ID PAGO", width: 38 },
      { title: "ID PRÉSTAMO", width: 38 },
    ],
    payments.map((p) => [
      ...identity(p.loan_id),
      periodMap.get(p.period_id)?.number ?? null,
      date(p.paid_on),
      excelMoney(p.amount_cents),
      excelMoney(p.interest_cents),
      excelMoney(p.capital_cents),
      new Intl.DateTimeFormat("es-PE", {
        timeZone: "America/Lima",
        dateStyle: "short",
        timeStyle: "medium",
      }).format(new Date(p.created_at)),
      p.id,
      p.loan_id,
    ]),
  );
  const periodColumns: Column[] = [
    ...common,
    { title: "PERIODO" },
    dateColumn("INICIO"),
    dateColumn("FIN"),
    { title: "MESES" },
    moneyColumn("CAPITAL INICIAL"),
    moneyColumn("INTERÉS GENERADO"),
    moneyColumn("TOTAL PROGRAMADO"),
    dateColumn("INTERÉS PAGADO EL"),
    { title: "VIGENTE" },
    { title: "ID PERIODO", width: 38 },
    { title: "ID PRÉSTAMO", width: 38 },
  ];
  const periodRow = (p: Period): CellValue[] => [
    ...identity(p.loan_id),
    p.number,
    date(p.start_date),
    date(p.end_date),
    p.months,
    excelMoney(p.opening_capital),
    excelMoney(p.interest_generated),
    excelMoney(BigInt(p.opening_capital) + BigInt(p.interest_generated)),
    date(p.interest_settled_on),
    p.is_current ? "Sí" : "No",
    p.id,
    p.loan_id,
  ];
  setupSheet(
    book.addWorksheet("Periodos"),
    periodColumns,
    periods.map(periodRow),
  );
  setupSheet(
    book.addWorksheet("Refinanciaciones"),
    periodColumns,
    periods.filter((p) => p.number > 1).map(periodRow),
  );
  setupSheet(
    book.addWorksheet("Clientes"),
    [
      { title: "CÓDIGO STAND", format: "@" },
      { title: "CONDICIÓN" },
      { title: "APELLIDOS Y NOMBRES", width: 34 },
      { title: "DNI", format: "@" },
      { title: "CELULAR", format: "@" },
      { title: "DIRECCIÓN", width: 35 },
      { title: "OBSERVACIONES", width: 45 },
      { title: "FECHA DE REGISTRO", width: 24 },
      { title: "ID CLIENTE", width: 38 },
    ],
    input.clients
      .filter((c) => loans.some((l) => l.client_id === c.id))
      .map((c) => [
        c.stand_code ?? "Por registrar",
        c.member_type ?? "Por registrar",
        c.full_name,
        c.dni,
        c.phone,
        c.address ?? "",
        c.notes ?? "",
        c.created_at
          ? new Intl.DateTimeFormat("es-PE", {
              timeZone: "America/Lima",
              dateStyle: "short",
              timeStyle: "medium",
            }).format(new Date(c.created_at))
          : "",
        c.id,
      ]),
  );
  const aggregate = (kind: "semana" | "mes") => {
    const sums = new Map<
      string,
      { total: bigint; interest: bigint; capital: bigint }
    >();
    payments.forEach((p) => {
      const key =
        kind === "semana" ? weekBounds(p.paid_on).start : p.paid_on.slice(0, 7);
      const value = sums.get(key) ?? { total: 0n, interest: 0n, capital: 0n };
      value.total += BigInt(p.amount_cents);
      value.interest += BigInt(p.interest_cents);
      value.capital += BigInt(p.capital_cents);
      sums.set(key, value);
    });
    return [...sums].sort(([a], [b]) => a.localeCompare(b));
  };
  for (const kind of ["semana", "mes"] as const)
    setupSheet(
      book.addWorksheet(
        kind === "semana" ? "Cobros por semana" : "Cobros por mes",
      ),
      [
        {
          title: kind === "semana" ? "SEMANA DESDE (LUNES)" : "MES",
          width: 24,
        },
        moneyColumn("TOTAL COBRADO"),
        moneyColumn("INTERÉS COBRADO"),
        moneyColumn("CAPITAL COBRADO"),
      ],
      aggregate(kind).map(([key, value]) => [
        key,
        excelMoney(value.total),
        excelMoney(value.interest),
        excelMoney(value.capital),
      ]),
    );
  setupSheet(
    book.addWorksheet("Guía"),
    [
      { title: "CAMPO", width: 28 },
      { title: "DESCRIPCIÓN", width: 110 },
    ],
    [
      ["Fecha de saldos", input.today + " · América/Lima"],
      [
        "Alcance",
        input.description ??
          "Préstamos seleccionados y sus historiales completos",
      ],
      [
        "N° préstamo",
        "Número de referencia del reporte, ordenado por fecha de desembolso e ID. El ID persistente del préstamo también se incluye.",
      ],
      [
        "Interés inicial (%)",
        "Tasa mensual × meses del primer periodo. Se incluye por separado la tasa mensual vigente.",
      ],
      [
        "Total a cobrar",
        "Capital original + intereses generados en todos los periodos, incluyendo refinanciaciones. No suma dos veces el capital trasladado.",
      ],
      [
        "Cuota 1, 2, …",
        "Importe pagado asignado a cada cuota del periodo vigente. El detalle de vencimientos, programado, pagado y saldo de todos los periodos está en Cuotas.",
      ],
      [
        "Colores de cuotas",
        "Verde: pagada. Rojo: vencida con saldo. Ámbar: pendiente o parcial. Gris/sin valor: no existe en el periodo vigente.",
      ],
      [
        "Historial completo",
        "Los filtros seleccionan préstamos; se incluyen todos sus pagos, cuotas y periodos para permitir conciliar el saldo.",
      ],
      [
        "Saldos históricos",
        "Los saldos de periodos anteriores están trasladados al periodo vigente. No sumarlos otra vez a la deuda actual.",
      ],
      [
        "Saldo",
        "Capital pendiente + interés pendiente. No agrega penalidades.",
      ],
      [
        "Precisión",
        "Importes con más de 15 dígitos en céntimos se escriben como texto decimal exacto para evitar redondeos de Excel.",
      ],
      [
        "Refinanciación",
        "Conserva todos los periodos y fechas originales; el cronograma vigente aparece en Cartera.",
      ],
    ],
  );
  return book;
}
export async function downloadCreditWorkbook(
  input: CreditExportData,
  filename = "pm-creditos-completo.xlsx",
) {
  const book = await buildCreditWorkbook(input);
  const buffer = await book.xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(buffer)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
