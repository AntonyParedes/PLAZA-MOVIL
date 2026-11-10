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
  const activeLoans = loans.filter(l => l.status === "activo");
  const settledLoans = loans.filter(l => l.status === "liquidado");
  const cartera = book.addWorksheet("Préstamos activos");
  setupSheet(
    cartera,
    columns,
    activeLoans.map((l) => {
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
  activeLoans.forEach((l, index) => {
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
  setupSheet(book.addWorksheet("Préstamos liquidados"), [
    {title:"CONDICIÓN",width:16}, {title:"N° PRÉSTAMO",width:12},
    {title:"CÓDIGO STAND",width:14,format:"@"},dateColumn("FECHA DEL PRÉSTAMO"),
    {title:"CELULAR",width:15,format:"@"},{title:"APELLIDOS Y NOMBRES",width:34},
    {title:"DNI",width:14,format:"@"},moneyColumn("MONTO PRESTADO"),
    moneyColumn("INTERÉS GENERADO"),moneyColumn("INTERÉS COBRADO"),moneyColumn("CAPITAL DEVUELTO"),
    moneyColumn("PENALIDAD COBRADA"),moneyColumn("TOTAL RECIBIDO"),dateColumn("FECHA DE LIQUIDACIÓN"),
    {title:"ESTADO",width:24},moneyColumn("DESCUENTO DE INTERÉS"),
  ], settledLoans.map(l => {
    const client=clients.get(l.client_id);
    const receipts=payments.filter(p=>p.loan_id===l.id);
    const total=(values:number[])=>values.reduce((sum,value)=>sum+BigInt(value),0n);
    const generated=periods.filter(p=>p.loan_id===l.id).reduce((sum,p)=>sum+BigInt(p.interest_generated),0n);
    const settledOn=receipts.map(p=>p.paid_on).sort().at(-1);
    return [client?.member_type?.toUpperCase() ?? "Por registrar",numbering.get(l.id)!,client?.stand_code ?? "Por registrar",date(startDate(l)),
      client?.phone ?? "",client?.full_name ?? "Cliente no disponible",client?.dni ?? "",excelMoney(l.original_capital),
      excelMoney(generated),excelMoney(total(receipts.map(p=>p.interest_cents))),excelMoney(total(receipts.map(p=>p.capital_cents))),
      excelMoney(total(receipts.map(p=>p.penalty_cents ?? 0))),excelMoney(receipts.reduce((sum,p)=>sum+paymentReceived(p),0n)),date(settledOn),"Liquidado / cancelado",excelMoney(total(receipts.map(p=>p.interest_discount_cents ?? 0)))];
  }));
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
      moneyColumn("DESCUENTO DE INTERÉS"),
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
      excelMoney(p.interest_discount_cents ?? 0),
    ]),
  );
  setupSheet(book.addWorksheet("Penalidades"), [
    ...common, dateColumn("FECHA DE COBRO"), moneyColumn("PENALIDAD COBRADA"),
    { title: "MOTIVO", width: 40 },
  ], payments.filter(p => (p.penalty_cents ?? 0) > 0).map(p => [
    ...identity(p.loan_id), date(p.paid_on), excelMoney(p.penalty_cents!), p.penalty_reason ?? "",
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
    ["DINERO DISPONIBLE EN CAJA",cash?.balance_cents != null ? excelMoney(BigInt(cash.balance_cents)) : null,cash?.configured ? "Dinero disponible para operar hoy. Ya incluye los cobros y descuenta los préstamos entregados y retiros." : "Sin calcular: falta registrar el dinero inicial de caja."],
    ["Capital pendiente en préstamos",excelMoney(capitalPending),"Dinero prestado que todavía falta recuperar. No incluye intereses."],
    ["Interés cobrado (ganancia)",cash ? excelMoney(BigInt(cash.interest_cents)) : excelMoney(sum(input.payments.map(p=>p.interest_cents))),"Todo el interés que ya se recibió. El capital devuelto no es ganancia."],
    ["Fecha de consulta",input.today,"Todo el historial. Estos importes son globales y no cambian por los filtros de préstamos."],
    ["Interés pendiente de cobro",excelMoney(interestPending),"Interés que aún falta cobrar; no se incluye como ganancia."],
    ["Saldo total por cobrar",excelMoney(capitalPending+interestPending),"Capital pendiente + interés pendiente."],
    ["Penalidades cobradas",cash ? excelMoney(BigInt(cash.penalty_cents)) : excelMoney(sum(input.payments.map(p=>p.penalty_cents??0))),"Ingreso adicional, separado de la ganancia por intereses."],
    ["Dinero inicial de caja",cash ? excelMoney(BigInt(cash.opening_cents)) : null,"Punto de partida de la caja."],
    ["Aportes a caja",cash ? excelMoney(BigInt(cash.contributions_cents)) : null,"Dinero adicional que entró."],
    ["Pagos recibidos acumulados",cash ? excelMoney(BigInt(cash.received_cents)) : null,"Entradas por capital devuelto, interés y penalidades. No sumar otra vez la ganancia a la caja."],
    ["Capital desembolsado acumulado",cash ? excelMoney(BigInt(cash.disbursed_cents)) : excelMoney(sum(input.loans.map(l=>l.original_capital))),"Dinero que salió para entregar préstamos. Refinanciar no cuenta como otro desembolso."],
    ["Retiros de caja",cash ? excelMoney(BigInt(cash.withdrawals_cents)) : null,"Dinero retirado de caja."],
    ["Cálculo de caja","Inicial + aportes + pagos − préstamos − retiros","El interés cobrado ya está dentro de los pagos recibidos."],
    ["Fecha del resumen de caja",cash?.as_of??null,"Fecha de Lima. El detalle de cada préstamo se encuentra en las hojas de activos y liquidados."],
  ];
  setupSheet(summary, [{title:"CONCEPTO",width:38}, moneyColumn("IMPORTE / VALOR"), {title:"DETALLE",width:70}], financialRows);
  summary.getRow(financialRows.findIndex(row=>row[0]==="Cálculo de caja")+2).getCell(2).alignment={wrapText:true,vertical:"middle"};
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
  appendSection("MOVIMIENTOS MANUALES DE CAJA", [dateColumn("FECHA (LIMA)"),{title:"TIPO"},moneyColumn("ENTRADA"),moneyColumn("SALIDA"),{title:"MOTIVO"}],
    (input.cashMovements ?? []).map(m => [
      date(new Intl.DateTimeFormat("en-CA",{timeZone:"America/Lima",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(m.created_at))),
      cashKindLabel[m.kind],m.kind !== "retiro" ? excelMoney(BigInt(m.amount_cents)) : null,
      m.kind === "retiro" ? excelMoney(BigInt(m.amount_cents)) : null,m.note,
    ]));
  summary.getColumn(2).width = 34;
  summary.getColumn(3).width = 18;
  for (let index=1; index<=financialRows.length+1; index++) {
    summary.mergeCells(index,3,index,6);
    summary.getRow(index).getCell(3).alignment = {wrapText:true,vertical:"middle"};
    summary.getRow(index).height = 36;
  }
  const balanceRow = summary.getRow(financialRows.findIndex(row=>row[0] === "DINERO DISPONIBLE EN CAJA") + 2);
  balanceRow.font = {bold:true};
  balanceRow.getCell(2).fill = {type:"pattern",pattern:"solid",fgColor:{argb:"FFD9EEDD"}};
  for(let index=4;index<=6;index++) summary.getColumn(index).width = index === 5 ? 40 : 20;
  for(let row=2;row<=4;row++){summary.getRow(row).font={bold:true,size:12};summary.getRow(row).height=48;}
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
