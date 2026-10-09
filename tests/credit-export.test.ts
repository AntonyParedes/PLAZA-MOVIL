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
      "Cartera",
      "Cuotas",
      "Pagos",
      "Periodos",
      "Refinanciaciones",
      "Clientes",
      "Cobros por semana",
      "Cobros por mes",
      "Guía",
    ],
  );
  const sheet = opened.getWorksheet("Cartera")!;
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
  assert.equal(opened.getWorksheet("Cuotas")!.rowCount, 9);
  assert.equal(opened.getWorksheet("Pagos")!.getCell("F2").value, 360);
  assert.ok(sheet.views[0].state === "frozen");
  assert.ok(sheet.autoFilter);
  assert.equal(
    sheet.getRow(2).getCell(column(sheet, "CUOTA 1")).fill.type,
    "pattern",
  );
  assert.equal(
    opened.getWorksheet("Clientes")!.getCell("G2").value,
    "Observación completa",
  );
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
  const sheet = book.getWorksheet("Cartera")!;
  assert.equal(
    sheet.getRow(2).getCell(column(sheet, "TOTAL A COBRAR")).value,
    1180,
  );
  assert.equal(sheet.getRow(2).getCell(column(sheet, "SALDO")).value, 820);
  assert.equal(
    sheet.getRow(2).getCell(column(sheet, "REFINANCIADO")).value,
    "Sí",
  );
  assert.equal(book.getWorksheet("Refinanciaciones")!.rowCount, 2);
  assert.equal(book.getWorksheet("Periodos")!.rowCount, 3);
  assert.equal(book.getWorksheet("Cuotas")!.rowCount, 13);
  assert.equal(sheet.getRow(2).getCell(column(sheet, "CUOTA 1")).value, 0);
  assert.equal(sheet.getRow(2).getCell(column(sheet, "CUOTA 5")).value, null);
  const empty = await buildCreditWorkbook({ ...data, selectedLoanIds: [] });
  assert.equal(empty.getWorksheet("Cartera")!.rowCount, 1);
  assert.equal(empty.getWorksheet("Pagos")!.rowCount, 1);
});
test("texto de clientes no se ejecuta como fórmula y céntimos grandes se conservan exactamente", async () => {
  const book = await buildCreditWorkbook({
    ...data,
    clients: [
      { ...data.clients[0], full_name: '=HYPERLINK("https://example.test")' },
    ],
  });
  const cell = book.getWorksheet("Cartera")!.getCell("F2");
  assert.equal(cell.type, 3);
  assert.equal(cell.formula, undefined);
  assert.equal(excelMoney(9007199254740991n), "90071992547409.91");
  assert.equal(excelMoney(123456), 1234.56);
});
