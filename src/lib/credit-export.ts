import type { CellValue, Worksheet } from "exceljs";
import { decimalSoles } from "./finance";
import { cashKindLabel, type CashSummary, type CashMovement } from "./cash";
import { collectionStatus, weekdayLabel } from "./collection-status";
import {
  paymentReceived,
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
  cashSummary?: CashSummary;
  cashMovements?: CashMovement[];
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
  book.creator = "Rapi Créditos";
  book.title = "Cartera y cobros de Rapi Créditos";
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
      const schedule = installments
        .filter((i) => i.loan_id === l.id && i.is_current)
        .sort((a, b) => a.number - b.number);
      const generated = periods
        .filter((p) => p.loan_id === l.id)
        .reduce((sum, p) => sum + BigInt(p.interest_generated), 0n);
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
    book.addWorksheet("Pagos"),
    [
      ...common,
      { title: "PERIODO" },
      dateColumn("FECHA DE PAGO"),
      moneyColumn("TOTAL PAGADO"),
      moneyColumn("INTERÉS"),
      moneyColumn("CAPITAL"),
      moneyColumn("PENALIDAD"),
      { title: "MOTIVO DE PENALIDAD", width: 36 },
      { title: "REGISTRO (LIMA)", width: 24 },
      { title: "ID PAGO", width: 38 },
      { title: "ID PRÉSTAMO", width: 38 },
    ],
    payments.map((p) => [
      ...identity(p.loan_id),
      periodMap.get(p.period_id)?.number ?? null,
      date(p.paid_on),
      excelMoney(paymentReceived(p)),
      excelMoney(p.interest_cents),
      excelMoney(p.capital_cents),
      excelMoney(p.penalty_cents ?? 0),
      p.penalty_reason ?? "",
      new Intl.DateTimeFormat("es-PE", {
        timeZone: "America/Lima",
        dateStyle: "short",
        timeStyle: "medium",
      }).format(new Date(p.created_at)),
      p.id,
      p.loan_id,
    ]),
  );
  setupSheet(book.addWorksheet("Penalidades"), [
    ...common, dateColumn("FECHA DE COBRO"), moneyColumn("PENALIDAD COBRADA"),
    { title: "MOTIVO", width: 40 }, { title: "ID PAGO", width: 38 }, { title: "ID PRÉSTAMO", width: 38 },
  ], payments.filter(p => (p.penalty_cents ?? 0) > 0).map(p => [
    ...identity(p.loan_id), date(p.paid_on), excelMoney(p.penalty_cents!), p.penalty_reason ?? "", p.id, p.loan_id,
  ]));
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
    book.addWorksheet("Refinanciaciones"),
    periodColumns,
    periods.filter((p) => p.number > 1).map(periodRow),
  );
  const aggregate = () => {
    const sums = new Map<
      string,
      { total: bigint; interest: bigint; capital: bigint; penalty: bigint }
    >();
    payments.forEach((p) => {
      const key = p.paid_on.slice(0, 7);
      const value = sums.get(key) ?? { total: 0n, interest: 0n, capital: 0n, penalty: 0n };
      value.total += paymentReceived(p);
      value.interest += BigInt(p.interest_cents);
      value.capital += BigInt(p.capital_cents);
      value.penalty += BigInt(p.penalty_cents ?? 0);
      sums.set(key, value);
    });
    return [...sums].sort(([a], [b]) => a.localeCompare(b));
  };
  setupSheet(
      book.addWorksheet("Cobros por mes"),
      [
        {
          title: "MES",
          width: 24,
        },
        moneyColumn("TOTAL COBRADO"),
        moneyColumn("INTERÉS COBRADO"),
        moneyColumn("CAPITAL COBRADO"),
        moneyColumn("PENALIDAD COBRADA"),
      ],
      aggregate().map(([key, value]) => [
        key,
        excelMoney(value.total),
        excelMoney(value.interest),
        excelMoney(value.capital),
        excelMoney(value.penalty),
      ]),
    );
  const summary = book.addWorksheet("Resumen financiero");
  const cash = input.cashSummary;
  const sum = (values: (number | string)[]) => values.reduce<bigint>((total, value) => total + BigInt(value), 0n);
  const capitalPending = sum(input.loans.map(l => l.capital_pending));
  const interestPending = sum(input.loans.map(l => l.interest_pending));
  const financialRows: CellValue[][] = [
    ["Fecha de consulta", input.today, "Importes en soles. Resumen global, sin aplicar los filtros de Cartera."],
    ["Capital pendiente en préstamos", excelMoney(capitalPending), "Dinero prestado que falta recuperar; no suma capital trasladado al refinanciar."],
    ["Interés pendiente de cobro", excelMoney(interestPending), "Interés generado que aún no se ha cobrado; no es ganancia recibida."],
    ["Saldo total por cobrar", excelMoney(capitalPending + interestPending), "Capital pendiente + interés pendiente."],
    ["Capital desembolsado acumulado", excelMoney(sum(input.loans.map(l => l.original_capital))), "Capital entregado en préstamos originales; refinanciar no es otro desembolso."],
    ["Interés cobrado (ganancia)", cash ? excelMoney(BigInt(cash.interest_cents)) : excelMoney(sum(input.payments.map(p => p.interest_cents))), "Todo el interés efectivamente recibido, sin incluir capital ni penalidades."],
    ["Penalidades cobradas", cash ? excelMoney(BigInt(cash.penalty_cents)) : excelMoney(sum(input.payments.map(p => p.penalty_cents ?? 0))), "Ingreso separado del interés."],
    ["Dinero inicial de caja", cash ? excelMoney(BigInt(cash.opening_cents)) : null, cash ? (cash.configured ? "Monto inicial registrado." : "Caja sin configurar: falta registrar el dinero inicial.") : "Información de caja no disponible."],
    ["Aportes a caja", cash ? excelMoney(BigInt(cash.contributions_cents)) : null, "Entradas manuales adicionales."],
    ["Pagos recibidos acumulados", cash ? excelMoney(BigInt(cash.received_cents)) : null, "Capital + interés + penalidades cobradas, contadas una sola vez."],
    ["Préstamos entregados (salida de caja)", cash ? excelMoney(BigInt(cash.disbursed_cents)) : null, "Desembolsos originales registrados en caja."],
    ["Retiros de caja", cash ? excelMoney(BigInt(cash.withdrawals_cents)) : null, "Salidas manuales registradas."],
    ["DINERO DISPONIBLE EN CAJA", cash?.balance_cents != null ? excelMoney(BigInt(cash.balance_cents)) : null, cash?.configured ? "Inicial + aportes + pagos recibidos − préstamos entregados − retiros. El interés cobrado ya forma parte de los pagos; no se vuelve a sumar." : "Sin calcular: registra primero el dinero inicial de caja."],
    ["Fecha del resumen de caja", cash?.as_of ?? null, "Fecha de la consulta de caja en América/Lima."],
  ];
  setupSheet(summary, [{title:"CONCEPTO",width:38}, moneyColumn("IMPORTE / VALOR"), {title:"DETALLE",width:70}], financialRows);
  // Mixed sections share one worksheet; a single autofilter would hide unrelated totals.
  summary.autoFilter = undefined;
  const appendSection = (title: string, columns: Column[], rows: CellValue[][]) => {
    summary.addRow([]);
    summary.addRow([title]).font = { bold: true, size: 13 };
    const header = summary.addRow(columns.map(c => c.title));
    header.font = {bold:true};
    header.height = 42;
    header.alignment = {wrapText:true,vertical:"middle"};
    header.eachCell(cell => {cell.fill = {type:"pattern",pattern:"solid",fgColor:{argb:"FFD9EEDD"}};});
    rows.forEach(values => {
      const row = summary.addRow(values);
      columns.forEach((column,index) => { if(column.format) row.getCell(index+1).numFmt = column.format; });
    });
  };
  appendSection("DETALLE GLOBAL DE PRÉSTAMOS", [
    ...common, dateColumn("FECHA DEL PRÉSTAMO"), {title:"ESTADO"},
    moneyColumn("CAPITAL PRESTADO"), moneyColumn("INTERÉS GENERADO"), moneyColumn("CAPITAL COBRADO"),
    moneyColumn("INTERÉS COBRADO"), moneyColumn("PENALIDAD COBRADA"), moneyColumn("TOTAL PAGADO"),
    moneyColumn("CAPITAL PENDIENTE"), moneyColumn("INTERÉS PENDIENTE"), moneyColumn("SALDO"),
    {title:"REFINANCIADO"}, {title:"ID PRÉSTAMO"},
    dateColumn("FECHA PRÓXIMA CUOTA"),{title:"DÍAS DE ATRASO"},{title:"PERIODO VIGENTE"},{title:"TASA MENSUAL (%)",format:"0.00%"},
  ], allLoans.map(l => {
    const c = clients.get(l.client_id);
    const receipts = input.payments.filter(p => p.loan_id === l.id);
    const history = input.periods.filter(p => p.loan_id === l.id);
    const status = collectionStatus(l, input.periods, input.installments, input.today);
    return [numbering.get(l.id)!,c?.full_name ?? "Cliente no disponible",c?.stand_code ?? "Por registrar",date(startDate(l)),
      status.state === "Atrasado" ? `Se atrasó ${status.daysLate} días` : status.state,
      excelMoney(l.original_capital),excelMoney(sum(history.map(p => p.interest_generated))),
      excelMoney(sum(receipts.map(p => p.capital_cents))),excelMoney(sum(receipts.map(p => p.interest_cents))),
      excelMoney(sum(receipts.map(p => p.penalty_cents ?? 0))),excelMoney(receipts.reduce((total,p) => total + paymentReceived(p),0n)),
      excelMoney(l.capital_pending),excelMoney(l.interest_pending),excelMoney(BigInt(l.capital_pending)+BigInt(l.interest_pending)),
      status.refinanced ? "Sí" : "No",l.id,date(status.nextDate),status.daysLate,history.find(p=>p.is_current)?.number ?? null,l.rate_basis_points / 10000];
  }));
  appendSection("MOVIMIENTOS MANUALES DE CAJA", [dateColumn("FECHA (LIMA)"),{title:"TIPO"},moneyColumn("ENTRADA"),moneyColumn("SALIDA"),{title:"MOTIVO"},{title:"ID MOVIMIENTO"}],
    (input.cashMovements ?? []).map(m => [
      date(new Intl.DateTimeFormat("en-CA",{timeZone:"America/Lima",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(m.created_at))),
      cashKindLabel[m.kind],m.kind !== "retiro" ? excelMoney(BigInt(m.amount_cents)) : null,
      m.kind === "retiro" ? excelMoney(BigInt(m.amount_cents)) : null,m.note,m.id,
    ]));
  summary.getColumn(2).width = 34;
  summary.getColumn(3).width = 18;
  for (let index=1; index<=financialRows.length+1; index++) {
    summary.mergeCells(index,3,index,8);
    summary.getRow(index).getCell(3).alignment = {wrapText:true,vertical:"middle"};
    summary.getRow(index).height = 36;
  }
  const balanceRow = summary.getRow(financialRows.findIndex(row=>row[0] === "DINERO DISPONIBLE EN CAJA") + 2);
  balanceRow.font = {bold:true};
  balanceRow.getCell(2).fill = {type:"pattern",pattern:"solid",fgColor:{argb:"FFD9EEDD"}};
  for(let index=4;index<=20;index++) summary.getColumn(index).width = index === 16 ? 38 : 20;
  setupSheet(
    book.addWorksheet("Guía"),
    [
      { title: "CAMPO", width: 28 },
      { title: "DESCRIPCIÓN", width: 110 },
    ],
    [
      ["Penalidades", "Ingreso opcional cobrado al liquidar, separado de capital e interés. Total pagado incluye penalidad una sola vez; Total a cobrar y cuotas muestran solo capital e interés."],
      ["Fecha de saldos", input.today + " · América/Lima"],
      [
        "Alcance",
        input.description ??
          "Préstamos seleccionados y sus historiales completos",
      ],
      [
        "N° préstamo",
        "Número de referencia del reporte, ordenado por fecha de desembolso e ID. El ID persistente se encuentra en Resumen financiero.",
      ],
      [
        "Interés inicial (%)",
        "Tasa mensual × meses del primer periodo. El detalle de los periodos refinanciados está en Refinanciaciones.",
      ],
      [
        "Total a cobrar",
        "Capital original + intereses generados en todos los periodos, incluyendo refinanciaciones. No suma dos veces el capital trasladado.",
      ],
      [
        "Cuota 1, 2, …",
        "Importe pagado asignado a cada cuota del periodo vigente. Se conserva el cronograma en columnas, sin una hoja adicional de cuotas.",
      ],
      [
        "Colores de cuotas",
        "Verde: pagada. Rojo: vencida con saldo. Ámbar: pendiente o parcial. Gris/sin valor: no existe en el periodo vigente.",
      ],
      [
        "Historial completo",
        "Los filtros seleccionan préstamos; se incluyen sus pagos y refinanciaciones. Resumen financiero siempre muestra toda la cartera y caja, sin filtros.",
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
        "Conserva fechas y condiciones de los periodos refinanciados; el cronograma vigente aparece en Cartera.",
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
