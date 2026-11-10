import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCreditWorkbook,
  excelMoney,
  type CreditExportData,
} from "../src/lib/credit-export";
const data: CreditExportData = {
  today: "2026-10-09",
  clients: [
    {
      id: "client",
      full_name: "Cliente Completo",
      dni: "01234567",
      phone: "999999999",
      stand_code: "004",
      member_type: "trabajador",
      address: "Plaza Móvil",
      notes: "Observación completa",
      created_at: "2026-08-14T15:00:00Z",
    },
  ],
  loans: [
    {
      id: "loan",
      client_id: "client",
      original_capital: 100000,
      capital_pending: 76000,
      interest_pending: 0,
      rate_basis_points: 600,
      status: "activo",
      created_at: "2026-08-14T15:00:00Z",
    },
  ],
  periods: [
    {
      id: "original",
      loan_id: "loan",
      number: 1,
      start_date: "2026-08-14",
      end_date: "2026-10-09",
      months: 2,
      opening_capital: 100000,
      interest_generated: 12000,
      interest_settled_on: "2026-10-09",
      is_current: true,
    },
  ],
  installments: Array.from({ length: 8 }, (_, index) => ({
    id: `quota-${index}`,
    period_id: "original",
    loan_id: "loan",
    number: index + 1,
    due_date: [
      "2026-08-21",
      "2026-08-28",
      "2026-09-04",
      "2026-09-11",
      "2026-09-18",
      "2026-09-25",
      "2026-10-02",
      "2026-10-09",
    ][index],
    scheduled_cents: 14000,
    paid_cents: index < 2 ? 14000 : index === 2 ? 8000 : 0,
    pending_cents: index < 2 ? 0 : index === 2 ? 6000 : 14000,
    is_current: true,
    status: "pendiente",
  })),
  payments: [
    {
      id: "payment",
      loan_id: "loan",
      period_id: "original",
      amount_cents: 36000,
      interest_cents: 12000,
      capital_cents: 24000,
      paid_on: "2026-09-04",
      created_at: "2026-09-04T15:00:00Z",
    },
  ],
};
function column(sheet: import("exceljs").Worksheet, name: string) {
  const index = (sheet.getRow(1).values as string[]).indexOf(name);
  assert.ok(index > 0, `Columna ${name}`);
  return index;
}
test("Excel real conserva identificación, ocho cuotas, números, fechas y hojas completas al abrirlo de nuevo", async () => {
  const book = await buildCreditWorkbook(data);
  const { default: ExcelJS } = await import("exceljs");
  const opened = new ExcelJS.Workbook();
  await opened.xlsx.load(await book.xlsx.writeBuffer());
  assert.deepEqual(
    opened.worksheets.map((s) => s.name),
    [
      "Préstamos activos",
      "Préstamos liquidados",
      "Pagos",
      "Penalidades",
      "Refinanciaciones",
      "Cobros por mes",
      "Resumen financiero",
    ],
  );
  const sheet = opened.getWorksheet("Préstamos activos")!;
  const value = (header: string) =>
    sheet.getRow(2).getCell(column(sheet, header)).value;
  assert.equal(value("DNI"), "01234567");
  assert.equal(value("CÓDIGO STAND"), "004");
  assert.equal(value("CELULAR"), "999999999");
  assert.equal(value("CONDICIÓN"), "TRABAJADOR");
  assert.equal(value("MONTO PRESTADO"), 1000);
  assert.equal(value("INTERÉS INICIAL (%)"), 0.12);
  assert.equal(value("TOTAL A COBRAR"), 1120);
  assert.equal(value("CUOTA SEMANAL"), 140);
  assert.equal(value("SALDO"), 760);
  assert.equal(value("CUOTA 1"), 140);
  assert.equal(value("CUOTA 3"), 80);
  assert.equal(value("CUOTA 8"), 0);
  assert.equal(value("N° CUOTAS"), 8);
  assert.equal(value("DÍA DE PAGO"), "viernes");
  assert.equal(value("ESTADO"), "En mora");
  assert.equal(
    (value("FECHA") as Date).toISOString().slice(0, 10),
    "2026-08-14",
  );
  assert.equal(opened.getWorksheet("Pagos")!.getCell("F2").value, 360);
  assert.ok(sheet.views[0].state === "frozen");
  assert.ok(sheet.autoFilter);
  assert.equal(
    sheet.getRow(2).getCell(column(sheet, "CUOTA 1")).fill.type,
    "pattern",
  );
  const headers = sheet.getRow(1).values as string[];
  for (const removed of ["FECHA PRÓXIMA CUOTA","DÍAS DE ATRASO","REFINANCIADO","PERIODO VIGENTE","TASA MENSUAL (%)","INTERÉS GENERADO","TOTAL PAGADO","CAPITAL PENDIENTE","INTERÉS PENDIENTE","ID PRÉSTAMO","PENALIDAD COBRADA"]) assert.ok(!headers.includes(removed), removed);

});
test("refinanciación conserva históricos sin sumar otra vez capital y selección respeta préstamos", async () => {
  const refi: CreditExportData = {
    ...data,
    periods: [
      { ...data.periods[0], is_current: false },
      {
        ...data.periods[0],
        id: "new",
        number: 2,
        months: 1,
        opening_capital: 76000,
        interest_generated: 6000,
        is_current: true,
      },
    ],
    installments: [
      ...data.installments.map((i) => ({ ...i, is_current: false })),
      ...Array.from({ length: 4 }, (_, index) => ({
        ...data.installments[0],
        id: `new-${index}`,
        period_id: "new",
        number: index + 1,
        due_date: ["2026-10-16", "2026-10-23", "2026-10-30", "2026-11-06"][
          index
        ],
        scheduled_cents: 20500,
        paid_cents: 0,
        pending_cents: 20500,
        is_current: true,
      })),
    ],
    loans: [{ ...data.loans[0], interest_pending: 6000 }],
    selectedLoanIds: ["loan"],
  };
  const book = await buildCreditWorkbook(refi);
  const sheet = book.getWorksheet("Préstamos activos")!;
  assert.equal(
    sheet.getRow(2).getCell(column(sheet, "TOTAL A COBRAR")).value,
    1180,
  );
  assert.equal(sheet.getRow(2).getCell(column(sheet, "SALDO")).value, 820);
  assert.equal(book.getWorksheet("Refinanciaciones")!.rowCount, 2);
  assert.equal(sheet.getRow(2).getCell(column(sheet, "CUOTA 1")).value, 0);
  assert.equal(sheet.getRow(2).getCell(column(sheet, "CUOTA 5")).value, null);
  const empty = await buildCreditWorkbook({ ...data, selectedLoanIds: [] });
  assert.equal(empty.getWorksheet("Préstamos activos")!.rowCount, 1);
  assert.equal(empty.getWorksheet("Pagos")!.rowCount, 1);
});
test("texto de clientes no se ejecuta como fórmula y céntimos grandes se conservan exactamente", async () => {
  const book = await buildCreditWorkbook({
    ...data,
    clients: [
      { ...data.clients[0], full_name: '=HYPERLINK("https://example.test")' },
    ],
  });
  const cell = book.getWorksheet("Préstamos activos")!.getCell("F2");
  assert.equal(cell.type, 3);
  assert.equal(cell.formula, undefined);
  assert.equal(excelMoney(9007199254740991n), "90071992547409.91");
  assert.equal(excelMoney(123456), 1234.56);
});

test("Excel separa penalidad cobrada de capital e interés y la incluye una sola vez en el total", async () => {
 const input=structuredClone(data);
 input.today='2026-10-10';input.loans[0].status='liquidado';input.loans[0].capital_pending=0;
 input.payments[0]={...input.payments[0],amount_cents:112000,capital_cents:100000,interest_cents:12000,penalty_cents:5000,penalty_reason:'Plazo vencido',paid_on:'2026-10-10'};
 input.installments=input.installments.map(i=>({...i,paid_cents:i.scheduled_cents,pending_cents:0,status:'pagado'}));
 const book=await buildCreditWorkbook(input);
 const register=book.getWorksheet('Penalidades')!;
 assert.equal(register.rowCount,2);assert.equal(register.getRow(2).getCell(column(register,'PENALIDAD COBRADA')).value,50);
 const pagos=book.getWorksheet('Pagos')!;
 for(const [name,expected] of [['TOTAL PAGADO',1170],['INTERÉS',120],['CAPITAL',1000],['PENALIDAD',50],['MOTIVO DE PENALIDAD','Plazo vencido']] as const) assert.equal(pagos.getRow(2).getCell(column(pagos,name)).value,expected,name);
 for(const name of ['Cobros por mes']) {
  const sheet=book.getWorksheet(name)!;
  assert.equal(sheet.getRow(2).getCell(column(sheet,'PENALIDAD COBRADA')).value,50);
  assert.equal(sheet.getRow(2).getCell(column(sheet,'TOTAL COBRADO')).value,1170);
 }
});

function metric(sheet: import("exceljs").Worksheet, title: string) {
  const row = sheet.getRows(2, sheet.rowCount - 1)!.find(row => row.getCell(1).value === title);
  assert.ok(row, title);
  return row.getCell(2).value;
}
test("resumen financiero global concilia caja, préstamos e ingresos aunque Cartera esté filtrada", async () => {
  const input: CreditExportData = {
    ...data,
    loans:[...data.loans,{...data.loans[0],id:"second",original_capital:50000,capital_pending:40000,interest_pending:3500}],
    selectedLoanIds:[],
    cashSummary:{configured:true,opening_cents:"200000",contributions_cents:"10000",withdrawals_cents:"5000",received_cents:"41000",disbursed_cents:"150000",penalty_cents:"5000",interest_cents:"12000",month_interest_cents:"0",balance_cents:"96000",as_of:data.today},
    cashMovements:[{id:"opening",kind:"apertura",amount_cents:200000,note:"Capital inicial",created_at:"2026-08-01T02:00:00Z"},{id:"out",kind:"retiro",amount_cents:5000,note:"Retiro registrado",created_at:"2026-09-01T15:00:00Z"}],
  };
  const book=await buildCreditWorkbook(input);
  assert.equal(book.getWorksheet("Préstamos activos")!.rowCount,1);
  const summary=book.getWorksheet("Resumen financiero")!;
  for(const [title,value] of [["Capital pendiente en préstamos",1160],["Interés pendiente de cobro",35],["Saldo total por cobrar",1195],["Capital desembolsado acumulado",1500],["Interés cobrado (ganancia)",120],["Penalidades cobradas",50],["DINERO DISPONIBLE EN CAJA",960]] as const) assert.equal(metric(summary,title),value,title);
  const rows=summary.getRows(1,summary.rowCount)!;
  const movement=rows.find(row=>row.getCell(5).value==="Capital inicial")!;
  assert.equal((movement.getCell(1).value as Date).toISOString().slice(0,10),"2026-07-31");
  assert.equal(movement.getCell(3).value,2000);
  assert.equal(movement.getCell(4).value,null);
  assert.equal(summary.autoFilter,undefined);
});
test("caja sin configurar no se exporta como saldo cero", async () => {
 const book=await buildCreditWorkbook({...data,cashSummary:{configured:false,opening_cents:"0",contributions_cents:"0",withdrawals_cents:"0",received_cents:"36000",disbursed_cents:"100000",penalty_cents:"0",interest_cents:"12000",month_interest_cents:"0",balance_cents:null,as_of:data.today}});
 assert.equal(metric(book.getWorksheet("Resumen financiero")!,"DINERO DISPONIBLE EN CAJA"),null);
});

test("Excel separa activos y liquidados, acumula interés de refinanciaciones y capital devuelto sin duplicarlo", async () => {
 const closed={...data.loans[0],id:"closed",status:"liquidado" as const,capital_pending:0,interest_pending:0};
 const input:CreditExportData={...data,loans:[...data.loans,closed],periods:[...data.periods,
  {...data.periods[0],id:"old-closed",loan_id:"closed",is_current:false},
  {...data.periods[0],id:"refi-closed",loan_id:"closed",number:2,opening_capital:76000,interest_generated:6000}],
  payments:[...data.payments,{...data.payments[0],id:"first-closed",loan_id:"closed",period_id:"old-closed"},
   {...data.payments[0],id:"last-closed",loan_id:"closed",period_id:"refi-closed",amount_cents:82000,capital_cents:76000,interest_cents:6000,penalty_cents:5000,penalty_reason:"Plazo vencido",paid_on:"2026-10-10"}]};
 const book=await buildCreditWorkbook(input);
 const {default:ExcelJS}=await import("exceljs");const opened=new ExcelJS.Workbook();await opened.xlsx.load(await book.xlsx.writeBuffer());
 const active=opened.getWorksheet("Préstamos activos")!, settled=opened.getWorksheet("Préstamos liquidados")!;
 assert.equal(active.rowCount,2);assert.equal(settled.rowCount,2);
 const value=(name:string)=>settled.getRow(2).getCell(column(settled,name)).value;
 for(const [name,expected] of [["MONTO PRESTADO",1000],["INTERÉS GENERADO",180],["INTERÉS COBRADO",180],["CAPITAL DEVUELTO",1000],["PENALIDAD COBRADA",50],["TOTAL RECIBIDO",1230]] as const) assert.equal(value(name),expected,name);
 assert.equal((value("FECHA DE LIQUIDACIÓN") as Date).toISOString().slice(0,10),"2026-10-10");
 assert.equal(opened.getWorksheet("Guía"),undefined);
 for(const name of ["Penalidades","Refinanciaciones"]) {
  const headers=opened.getWorksheet(name)!.getRow(1).values as string[];
  for(const id of ["ID PAGO","ID PRÉSTAMO","ID PERIODO"]) assert.ok(!headers.includes(id),`${name}: ${id}`);
 }
 const onlyClosed=await buildCreditWorkbook({...input,selectedLoanIds:["closed"]});
 assert.equal(onlyClosed.getWorksheet("Préstamos activos")!.rowCount,1);
 assert.equal(onlyClosed.getWorksheet("Préstamos liquidados")!.rowCount,2);
});

test("Excel separa descuentos de interés del efectivo cobrado", async () => {
  const book = await buildCreditWorkbook({...data,
    payments: [{...data.payments[0], interest_discount_cents:3000}],
    installments: data.installments.map((i,index)=>({...i,discounted_cents:index===2?3000:0})),
  });
  const {default: ExcelJS} = await import("exceljs");
  const opened = new ExcelJS.Workbook();
  await opened.xlsx.load(await book.xlsx.writeBuffer());
  const payments=opened.getWorksheet("Pagos")!;
  assert.equal(payments.getRow(2).getCell(column(payments,"DESCUENTO DE INTERÉS")).value,30);
  assert.equal(payments.getRow(2).getCell(column(payments,"TOTAL PAGADO")).value,360);
});
