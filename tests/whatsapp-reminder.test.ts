import test from "node:test";
import assert from "node:assert/strict";
import { whatsappReminder } from "../src/lib/whatsapp-reminder";
import {
  addDays,
  type Customer,
  type Installment,
  type Loan,
  type Period,
} from "../src/lib/portal";
const today = "2026-10-09";
const client: Customer = {
  id: "client",
  full_name: "Ana Pérez",
  dni: "12345678",
  phone: "999999999",
  stand_code: "A-01",
  member_type: "socio",
};
const loan: Loan = {
  id: "loan",
  client_id: "client",
  original_capital: 100000,
  capital_pending: 81000,
  interest_pending: 6000,
  rate_basis_points: 600,
  status: "activo",
  created_at: "2026-09-25T00:00:00Z",
};
const period: Period = {
  id: "period",
  loan_id: "loan",
  number: 1,
  start_date: "2026-09-25",
  end_date: "2026-10-23",
  months: 1,
  opening_capital: 100000,
  interest_generated: 6000,
  interest_settled_on: null,
  is_current: true,
};
const quota: Installment = {
  id: "quota",
  loan_id: "loan",
  period_id: "period",
  number: 1,
  due_date: today,
  scheduled_cents: 26500,
  paid_cents: 0,
  pending_cents: 26500,
  is_current: true,
  status: "pendiente",
};
const remind = (i: Installment, rows = [i]) =>
  whatsappReminder(client, loan, i, [period], rows, today);
test("recordatorio identifica cuota, saldo, fecha, estado y firma, sin atraso antes del vencimiento", () => {
  for (const due_date of [today, addDays(today, 1)]) {
    const text = remind({ ...quota, due_date });
    assert.match(text, /Hola Ana Pérez/);
    assert.match(text, /Cuota: 1/);
    assert.match(text, /Saldo de esta cuota: S\/\s*265\.00/);
    assert.match(text, /Estado de la cuota: Pendiente/);
    assert.match(text, /Días de atraso de esta cuota: 0 días/);
    assert.doesNotMatch(text, /penalidades|En mora/);
    assert.ok(text.endsWith("Atentamente,\nLa Gerencia\nPM Créditos"));
  }
});
test("uno y seis días muestran atraso; siete días muestran mora sin imponer una multa o plazo", () => {
  for (const days of [1, 6, 7]) {
    const text = remind({ ...quota, due_date: addDays(today, -days) });
    assert.ok(
      text.includes(`Estado de la cuota: ${days < 7 ? "Atrasada" : "En mora"}`),
    );
    assert.ok(
      text.includes(
        `Días de atraso de esta cuota: ${days} ${days === 1 ? "día" : "días"}`,
      ),
    );
    assert.match(
      text,
      /El atraso puede generar penalidades según las condiciones de tu préstamo\./,
    );
    assert.doesNotMatch(text, /multa de|penalidad de|automátic/);
  }
});
test("abono parcial recuerda solo el saldo pendiente y conserva los días desde la fecha original", () => {
  const text = remind({
    ...quota,
    paid_cents: 10000,
    pending_cents: 16500,
    due_date: addDays(today, -8),
  });
  assert.match(text, /Saldo de esta cuota: S\/\s*165\.00/);
  assert.match(text, /En mora \(pago parcial\)/);
  assert.match(text, /8 días/);
});
test("una cuota futura no se presenta vencida aunque el préstamo tenga otra cuota en mora; históricos no generan advertencia", () => {
  const future = {
    ...quota,
    id: "future",
    number: 2,
    due_date: addDays(today, 1),
  };
  const older = { ...quota, due_date: addDays(today, -7) };
  const text = remind(future, [older, future]);
  assert.match(text, /Estado de la cuota: Pendiente/);
  assert.match(text, /Días de atraso de esta cuota: 0 días/);
  assert.match(
    text,
    /Estado del préstamo: En mora\. La cuota pendiente más antigua tiene 7 días de atraso\./,
  );
  const clean = remind(future, [{ ...older, is_current: false }, future]);
  assert.doesNotMatch(clean, /penalidades|Estado del préstamo: En mora/);
});
