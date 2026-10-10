import test from "node:test";
import assert from "node:assert/strict";
import {
  clientAccount,
  clientWhatsApp,
  type AccountData,
} from "../src/lib/client-account";
import type { Customer } from "../src/lib/portal";
const client: Customer = {
  id: "c",
  full_name: "Ana Socia",
  dni: "01234567",
  phone: "999999999",
  stand_code: "01",
  member_type: "socio",
};
function fixture(): AccountData {
  return {
    loans: [
      {
        id: "old",
        client_id: "c",
        original_capital: 100000,
        capital_pending: 0,
        interest_pending: 0,
        rate_basis_points: 600,
        status: "liquidado",
        created_at: "2026-08-01",
      },
      {
        id: "active",
        client_id: "c",
        original_capital: 100000,
        capital_pending: 80000,
        interest_pending: 2000,
        rate_basis_points: 600,
        status: "activo",
        created_at: "2026-09-01",
      },
      {
        id: "other",
        client_id: "different",
        original_capital: 50000,
        capital_pending: 50000,
        interest_pending: 3500,
        rate_basis_points: 700,
        status: "activo",
        created_at: "2026-09-01",
      },
    ],
    periods: [
      {
        id: "p",
        loan_id: "active",
        number: 1,
        start_date: "2026-09-01",
        end_date: "2026-10-29",
        months: 1,
        opening_capital: 100000,
        interest_generated: 6000,
        interest_settled_on: null,
        is_current: true,
      },
    ],
    payments: [
      {
        id: "payold",
        loan_id: "old",
        period_id: "oldp",
        amount_cents: 106000,
        interest_cents: 6000,
        capital_cents: 100000,
        paid_on: "2026-08-29",
        created_at: "2026-08-29",
      },
      {
        id: "payactive",
        loan_id: "active",
        period_id: "p",
        amount_cents: 24000,
        interest_cents: 4000,
        capital_cents: 20000,
        paid_on: "2026-09-08",
        created_at: "2026-09-08",
      },
      {
        id: "otherpay",
        loan_id: "other",
        period_id: "otherp",
        amount_cents: 10000,
        interest_cents: 3500,
        capital_cents: 6500,
        paid_on: "2026-09-08",
        created_at: "2026-09-08",
      },
    ],
    installments: [
      {
        id: "q",
        loan_id: "active",
        period_id: "p",
        number: 2,
        due_date: "2026-10-02",
        scheduled_cents: 26500,
        paid_cents: 10000,
        pending_cents: 16500,
        is_current: true,
        status: "vencido",
      },
      {
        id: "historic",
        loan_id: "active",
        period_id: "historicp",
        number: 1,
        due_date: "2026-01-01",
        scheduled_cents: 26500,
        paid_cents: 0,
        pending_cents: 26500,
        is_current: false,
        status: "vencido",
      },
    ],
  };
}
test("ganancia suma solo interés cobrado de todos sus préstamos, sin capital ni interés generado ni otros clientes", () => {
  const a = clientAccount("c", fixture(), "2026-10-09");
  assert.equal(a.interestCollected, 10000n);
  assert.equal(a.balance, 82000n);
  assert.equal(a.state, "En mora");
  assert.equal(a.daysLate, 7);
  assert.equal(a.entries.length, 2);
});
test("WhatsApp toma cuota vigente más antigua, saldo parcial, atraso real y advertencia sin cargos automáticos", () => {
  const data = fixture();
  const text = clientWhatsApp(client, data, "2026-10-09");
  assert.match(text, /Estado: En mora/);
  assert.match(text, /Días de atraso de la cuota: 7/);
  assert.match(text, /Saldo de la cuota: S\/\s165\.00/);
  assert.match(text, /penalidades según las condiciones/);
  assert.match(text, /Atentamente,\nLa Gerencia/);
  assert.equal(clientAccount("c", data, "2026-10-03").state, "Atrasado");
  assert.equal(clientAccount("c", data, "2026-10-02").state, "Puntual");
});
test("liquidado y sin préstamo no aparentan mora ni cobranza pendiente", () => {
  const data = fixture();
  data.loans = data.loans.filter((l) => l.id !== "active");
  assert.equal(clientAccount("c", data, "2026-10-09").state, "Liquidado");
  assert.doesNotMatch(
    clientWhatsApp(client, data, "2026-10-09"),
    /penalidades/,
  );
  const empty = clientAccount("missing", data, "2026-10-09");
  assert.equal(empty.state, "Sin préstamos");
  assert.equal(empty.interestCollected, 0n);
  assert.equal(empty.balance, 0n);
});

test("urgencia de un préstamo prevalece en la cuenta y WhatsApp exige solo su saldo total", () => {
  const data = fixture();
  data.periods[0].end_date = "2026-10-08";
  const a = clientAccount("c", data, "2026-10-09");
  assert.equal(a.state, "Liquidación urgente");
  const message = clientWhatsApp(client, data, "2026-10-09");
  assert.match(message, /Estado: Liquidación urgente/);
  assert.match(message, /100 % del saldo restante: S\/\s*820\.00/);
  assert.doesNotMatch(message, /En mora/);
});
