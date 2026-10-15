import { test, expect, type Page } from "@playwright/test";
const userId = "11111111-1111-4111-8111-111111111111";
const clientId = "22222222-2222-4222-8222-222222222222";
async function mockSupabase(
  page: Page,
  role: "administrador" | "jefe",
  tables: Record<string, unknown> = {},
) {
  const calls: { name: string; body: Record<string, unknown> }[] = [];
  const user = {
    id: userId,
    email: "prueba@example.test",
    aud: "authenticated",
    role: "authenticated",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: "2026-10-01T00:00:00Z",
  };
  await page.route("https://pm-e2e.supabase.co/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "content-type": "application/json",
    };
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
      return;
    }
    let body: unknown = [];
    if (url.pathname === "/auth/v1/token")
      body = {
        access_token: "mock-session-token",
        refresh_token: "mock-refresh-token",
        token_type: "bearer",
        expires_in: 3600,
        user,
      };
    else if (url.pathname === "/auth/v1/user") body = user;
    else if (url.pathname === "/auth/v1/logout") {
      await route.fulfill({ status: 204, headers });
      return;
    } else if (url.pathname === "/rest/v1/profiles") body = { role };
    else if (url.pathname === "/rest/v1/clients")
      body = tables.clients ?? [
        {
          id: clientId,
          full_name: "Cliente de prueba",
          dni: "12345678",
          phone: "999999999",
          address: "Lima",
          notes: "",
          stand_code: "A-01",
          member_type: "socio",
          created_at: "2026-10-01T00:00:00Z",
        },
      ];
    else if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const name = url.pathname.split("/").at(-1)!;
      calls.push({ name, body: request.postDataJSON() });
      body = "33333333-3333-4333-8333-333333333333";
    }
    if (
      url.pathname === "/rest/v1/clients" &&
      ["POST", "PATCH"].includes(request.method())
    ) {
      const fields = request.postDataJSON();
      calls.push({
        name: request.method() === "POST" ? "clients.insert" : "clients.update",
        body: fields,
      });
      body = {
        id: request.method() === "POST" ? "new-client" : clientId,
        ...fields,
        created_at: "2026-10-01T00:00:00Z",
      };
    }
    const table = url.pathname.split("/").at(-1)!;
    if (
      request.method() === "GET" &&
      url.pathname.startsWith("/rest/v1/") &&
      table in tables
    )
      body = tables[table];
    await route.fulfill({ status: 200, headers, body: JSON.stringify(body) });
  });
  return calls;
}
async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Correo electrónico").fill("prueba@example.test");
  await page.getByLabel("Contraseña").fill("contraseña-de-prueba");
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Menú de usuario", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Tu cartera, de un vistazo",
      exact: true,
    }),
  ).toBeVisible();
}
for (const [productId, capital, interest, quota] of [
  ["1000-2", 100000, 120, 140],
  ["1500-2", 150000, 180, 210],
  ["2000-2", 200000, 240, 280],
] as const)
  test(`administrador selecciona ${productId} de ocho cuotas y envía tasa mensual con UUID idempotente`, async ({
    page,
  }) => {
    const calls = await mockSupabase(page, "administrador");
    await login(page);
    await page
      .getByRole("button", { name: "Préstamos", exact: true })
      .click();
    await page.getByRole("button", { name: "Préstamos", exact: true }).click();
    await page.getByRole("button", { name: "Nuevo préstamo" }).click();
    await page.getByLabel("Monto del préstamo (S/)", { exact: true }).fill(String(capital / 100));
    await page.getByLabel("Plazo del préstamo", { exact: true }).selectOption("2");
    await page.getByLabel("Fecha del préstamo").fill("2026-10-09");
    await page.getByRole("button", { name: "Revisar cronograma" }).click();
    await expect(page.getByText(/Cuota 8 ·/)).toBeVisible();
    await expect(
      page.getByText(new RegExp(`Interés: S/\\s*${interest}\\.00`)),
    ).toBeVisible();
    await expect(page.getByText(/Cuota 8 ·/)).toContainText(`${quota}.00`);
    await expect(page.getByText(/Cuota 9 ·/)).toHaveCount(0);
    await page
      .getByRole("combobox", { name: "Cliente", exact: true })
      .selectOption(clientId);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Confirmar desembolso" }).click();
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0].name).toBe("create_loan");
    expect(calls[0].body).toMatchObject({
      p_client: clientId,
      p_capital: capital,
      p_rate: 600,
      p_months: 2,
      p_start: "2026-10-09",
    });
    expect(calls[0].body.p_request).toMatch(/^[0-9a-f-]{36}$/);
    await page.getByRole("button", { name: "Reportes", exact: true }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Historial de pagos CSV" }).click();
    expect((await download).suggestedFilename()).toBe("pagos-pm-creditos.csv");
    await expect(
      page.getByRole("button", { name: /anular|eliminar/i }),
    ).toHaveCount(0);
  });
test("jefe puede consultar pero no desembolsar ni importar", async ({
  page,
}) => {
  await mockSupabase(page, "jefe");
  await login(page);
  await expect(
    page.getByRole("button", { name: "Revisar Excel", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Clientes", exact: true }).click();
  await expect(
    page.getByText("Cliente de prueba", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Nuevo cliente" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Editar", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Préstamos", exact: true })
    .click();
  await page.getByRole("button", { name: "Préstamos", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Nuevo préstamo" }),
  ).toHaveCount(0);
});

test("Excel muestra duplicados, saldos inconsistentes y fórmulas sin escribir a la API", async ({
  page,
}) => {
  const calls = await mockSupabase(page, "administrador");
  await login(page);
  await navigateModule(page, "Configuración");
  await page.getByRole("button", { name: "Revisar Excel", exact: true }).click();
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Préstamos");
  sheet.addRow([
    "cliente",
    "dni",
    "capital_original",
    "capital_pendiente",
    "interes_pendiente",
    "fecha_prestamo",
    "tasa_mensual_porcentaje",
    "plazo_meses",
    "saldo_total",
  ]);
  sheet.addRow([
    "Cliente de prueba",
    "12345678",
    1000,
    810,
    0,
    "2026-10-09",
    6,
    1,
    810,
  ]);
  sheet.addRow([
    "Duplicado",
    "12345678",
    1000,
    1001,
    70,
    "2026-10-09",
    6,
    1,
    { formula: "D3+E3", result: 800 },
  ]);
  const buffer = Buffer.from(await book.xlsx.writeBuffer());
  await page.getByLabel("Seleccionar PRESTAMOS - PM.xlsx").setInputFiles({
    name: "PRESTAMOS - PM.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  await expect(
    page.getByText(/2 registros · 1 con errores · 1 con advertencias/),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Saldo total inconsistente con capital e interés pendientes.",
    ),
  ).toBeVisible();
  await expect(page.getByText(/Contiene fórmulas:/)).toBeVisible();
  expect(calls).toHaveLength(0);
});

test("conserva el acceso al volver a la pestaña y al restaurar la sesión; salir explícitamente sigue funcionando", async ({
  page,
}) => {
  await mockSupabase(page, "administrador");
  await login(page);
  await page.getByRole("button", { name: "Clientes", exact: true }).click();
  await expect(
    page.getByText("Cliente de prueba", { exact: true }),
  ).toBeVisible();
  // Exercise the real Supabase SDK visibility handler and wait for its auth notification.
  await page.evaluate(async () => {
    const key = Object.keys(localStorage).find(
      (key) => key.startsWith("sb-") && key.endsWith("-auth-token"),
    )!;
    await new Promise<void>((resolve) => {
      const observer = new BroadcastChannel(key);
      observer.onmessage = (event) => {
        if (event.data.event === "SIGNED_IN") {
          observer.close();
          resolve();
        }
      };
      window.dispatchEvent(new Event("visibilitychange"));
    });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await expect(
    page.getByText("Cliente de prueba", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Clientes", exact: true }),
  ).toBeEnabled();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Inicio", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Menú de usuario", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Cerrar sesión", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Iniciar sesión", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Iniciar sesión", exact: true }),
  ).toBeVisible();
});

test("panel general simplificado conserva seis columnas, prioriza atraso y despliega identificación y WhatsApp", async ({
  page,
}) => {
  const { limaDate, addDays } = await import("../src/lib/portal");
  const today = limaDate();
  const customers = ["Ana Socia", "Luis Trabajador", "Maria Liquidada"].map(
    (full_name, index) => ({
      id: `client-${index}`,
      full_name,
      dni: `1234567${index}`,
      phone: "999999999",
      stand_code: `S-0${index + 1}`,
      member_type: index === 1 ? "trabajador" : "socio",
      address: "Lima",
      created_at: `${today}T00:00:00Z`,
    }),
  );
  const loans = customers.map((c, index) => ({
    id: `loan-${index}`,
    client_id: c.id,
    original_capital: 100000,
    capital_pending: index === 2 ? 0 : 81000,
    interest_pending: index === 2 ? 0 : 6000,
    rate_basis_points: 600,
    status: index === 2 ? "liquidado" : "activo",
    created_at: `${today}T00:00:00Z`,
  }));
  const periods = loans.map((l, index) => ({
    id: `period-${index}`,
    loan_id: l.id,
    number: 1,
    start_date: addDays(today, -28),
    end_date: today,
    months: 1,
    opening_capital: 100000,
    interest_generated: 6000,
    interest_settled_on: null,
    is_current: index !== 1,
  }));
  periods.push({
    ...periods[1],
    id: "refinanced",
    number: 2,
    is_current: true,
    start_date: addDays(today, -14),
    end_date: addDays(today, 14),
  });
  const installments = loans.map((l, index) => ({
    id: `quota-${index}`,
    loan_id: l.id,
    period_id: index === 1 ? "refinanced" : `period-${index}`,
    number: 1,
    due_date: addDays(today, index === 0 ? -3 : -7),
    scheduled_cents: 26500,
    paid_cents: index === 2 ? 26500 : 0,
    pending_cents: index === 2 ? 0 : 26500,
    is_current: true,
    status: "pendiente",
  }));
  await mockSupabase(page, "administrador", {
    clients: customers,
    loans,
    loan_periods: periods,
    installment_balances: installments,
  });
  await login(page);
  await page
    .getByRole("button", { name: "Préstamos", exact: true })
    .click();
  const ana = page.getByRole("row").filter({ hasText: "Ana Socia" });
  await expect(ana).not.toContainText("S-01");
  await expect(ana).toContainText("Se atrasó 3 días");
  await expect(ana).toContainText("S/ 870.00");
  const luis = page.getByRole("row").filter({ hasText: "Luis Trabajador" });
  await expect(luis).not.toContainText("trabajador");
  await expect(luis).toContainText("En mora");
  await expect(
    page.getByRole("row").filter({ hasText: "Maria Liquidada" }),
  ).toContainText("Liquidado");
  await expect(
    page.getByRole("columnheader", { name: "Saldo", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Día de pago", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("table", { name: "Panel general de préstamos" })
      .getByRole("columnheader"),
  ).toHaveText([
    "Prestatario",
    "Fecha del préstamo",
    "Día de pago",
    "Saldo",
    "Cuota semanal",
    "Estado",
  ]);
  const table = page.getByRole("table", { name: "Panel general de préstamos" });
  await expect(table.getByRole("row").nth(1)).toContainText("Luis Trabajador");
  const open = ana.getByRole("button", {
    name: "Ver detalle de Ana Socia",
    exact: true,
  });
  await open.click();
  const detail = page.getByRole("dialog");
  await expect(detail).toContainText("S-01");
  await expect(detail).toContainText("socio");
  const href = await detail
    .getByRole("link", { name: "Recordar pago por WhatsApp" })
    .getAttribute("href");
  expect(new URL(href!).searchParams.get("text")).toContain(
    "Días de atraso de esta cuota: 3 días",
  );
  await page.keyboard.press("Escape");
  await expect(open).toBeFocused();
  await page
    .getByRole("combobox", { name: "Filtrar estado" })
    .selectOption("En mora");
  await expect(ana).toHaveCount(0);
  await expect(luis).toBeVisible();
  await page
    .getByRole("combobox", { name: "Filtrar estado" })
    .selectOption("todos");
  await page
    .getByRole("combobox", { name: "Filtrar condición" })
    .selectOption("socio");
  await expect(luis).toHaveCount(0);
  await expect(ana).toBeVisible();
  await page.getByRole("button", { name: "Clientes", exact: true }).click();
  await page.getByRole("button", { name: "Nuevo cliente" }).click();
  await expect(page.getByLabel("Código de stand")).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Condición", exact: true }),
  ).toBeVisible();
});

async function dashboardFixtures() {
  const { limaDate, addDays } = await import("../src/lib/portal");
  const today = limaDate();
  const names = [
    "Ana Socia",
    "Luis Trabajador",
    "Maria Liquidada",
    "Diego Puntual",
  ];
  const clients = names.map((full_name, index) => ({
    id: `client-${index}`,
    full_name,
    dni: `1234567${index}`,
    phone: "999999999",
    stand_code: `S-0${index + 1}`,
    member_type: index === 1 ? "trabajador" : "socio",
    address: "Av. Plaza Móvil 123",
    notes: "",
    created_at: `${today}T00:00:00Z`,
  }));
  const loans = clients.map((c, index) => ({
    id: `loan-${index}`,
    client_id: c.id,
    original_capital: 100000,
    capital_pending: index === 2 ? 0 : 81000,
    interest_pending: index === 0 ? 6000 : 0,
    rate_basis_points: 600,
    status: index === 2 ? "liquidado" : "activo",
    created_at: `${today}T00:00:00Z`,
  }));
  const loan_periods = loans.map((l, index) => ({
    id: `period-${index}`,
    loan_id: l.id,
    number: 1,
    start_date: addDays(today, -14),
    end_date: addDays(today, 14),
    months: 1,
    opening_capital: 100000,
    interest_generated: 6000,
    interest_settled_on: index === 0 ? null : today,
    is_current: true,
  }));
  const installment_balances = loans.map((l, index) => ({
    id: `quota-${index}`,
    loan_id: l.id,
    period_id: `period-${index}`,
    number: 1,
    due_date: index === 1 ? addDays(today, -7) : today,
    scheduled_cents: 26500,
    paid_cents: index === 2 ? 26500 : 0,
    pending_cents: index === 2 ? 0 : 26500,
    is_current: true,
    status: index === 2 ? "pagado" : index === 1 ? "vencido" : "pendiente",
  }));
  const payments = [
    {
      id: "payment-1",
      loan_id: "loan-2",
      period_id: "period-2",
      amount_cents: 106000,
      interest_cents: 6000,
      capital_cents: 100000,
      paid_on: today,
      created_at: `${today}T00:00:00Z`,
    },
  ];
  return { clients, loans, loan_periods, installment_balances, payments };
}
async function navigateModule(page: Page, name: string) {
  if (name === "Revisar Excel") {
    await navigateModule(page, "Configuración");
    await page.getByRole("button", { name, exact: true }).click();
    return;
  }
  if (page.viewportSize()!.width < 1024)
    await page.getByRole("button", { name: "Abrir menú", exact: true }).click();
  await page.getByRole("navigation", { name: "Menú principal" }).filter({ visible: true }).getByRole("button", { name, exact: true }).click();
  await expect(
    page.getByRole("heading", { name, exact: true, level: 1 }),
  ).toBeVisible();
}
for (const width of [375, 430, 768, 1024, 1440, 1920])
  test(`interfaz sin desbordamiento, navegación y detalle a ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockSupabase(page, "administrador", await dashboardFixtures());
    await login(page);
    await page.getByText("Más indicadores de cartera", { exact: true }).click();
    await expect(page.getByText("S/ 4,000.00", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Cobros de hoy y esta semana" }),
    ).toBeVisible();
    await expect(page.getByText("Pagado", { exact: true })).toBeVisible();
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
    expect(await overflow()).toBe(false);
    await page.screenshot({
      path: `test-results/dashboard-${width}.png`,
      fullPage: true,
    });
    if (width >= 1024) {
      await page
        .getByRole("button", { name: "Contraer menú", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Expandir menú", exact: true }),
      ).toBeVisible();
      expect(await overflow()).toBe(false);
      await page
        .getByRole("button", { name: "Expandir menú", exact: true })
        .click();
    }
    if (width < 1024)
      await page
        .getByRole("button", { name: "Abrir menú", exact: true })
        .click();
    await expect(
      page.getByRole("button", { name: "Cobros semanales", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Historial de pagos", exact: true }),
    ).toHaveCount(0);
    if (width < 1024) await page.keyboard.press("Escape");
    for (const name of [
      "Panel general",
      "Clientes",
      "Préstamos",
      "Reportes",
      "Configuración",
      "Revisar Excel",
    ]) {
      await navigateModule(page, name);
      expect(await overflow(), `${name} se ajusta al ancho ${width}`).toBe(
        false,
      );
    }
    await navigateModule(page, "Panel general");
    await page
      .getByRole("row")
      .filter({ hasText: "Ana Socia" })
      .getByRole("button", { name: "Ver detalle de Ana Socia", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByLabel("Monto (S/)")).toBeVisible();
    expect(await overflow()).toBe(false);
    await page.screenshot({
      path: `test-results/detail-${width}.png`,
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
test("pago confirmado mantiene el RPC, muestra éxito y bloquea refinanciación pendiente", async ({
  page,
}) => {
  const fixtures = await dashboardFixtures();
  const { limaDate, addDays } = await import("../src/lib/portal");
  fixtures.loan_periods[3].end_date = addDays(limaDate(), -1);
  const calls = await mockSupabase(page, "administrador", fixtures);
  await login(page);
  await page
    .getByRole("row")
    .filter({ hasText: "Ana Socia" })
    .getByRole("button", { name: "Registrar pago", exact: true })
    .click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await sheet
    .getByRole("button", { name: "Liquidar préstamo", exact: true })
    .click();
  await expect(sheet.getByLabel("Monto (S/)")).toHaveValue("870.00");
  await sheet.getByLabel("Monto (S/)").fill("265.00");
  page.once("dialog", (dialog) => dialog.dismiss());
  await sheet
    .getByRole("button", { name: "Confirmar pago", exact: true })
    .click();
  expect(calls).toHaveLength(0);
  page.once("dialog", (dialog) => dialog.accept());
  await sheet
    .getByRole("button", { name: "Confirmar pago", exact: true })
    .click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].name).toBe("record_payment");
  expect(calls[0].body).toMatchObject({
    p_loan: "loan-0",
    p_amount: 26500,
    p_paid_on: fixtures.payments[0].paid_on,
  });
  await expect(
    sheet.getByText("Pago registrado correctamente.", { exact: true }),
  ).toBeVisible();
  await sheet.getByText("Refinanciar un mes", { exact: true }).click();
  await expect(
    sheet.getByRole("button", {
      name: "Confirmar refinanciación",
      exact: true,
    }),
  ).toBeDisabled();
  await sheet
    .getByRole("button", { name: "Cerrar detalle", exact: true })
    .click();
  await navigateModule(page, "Préstamos");
  await page.getByRole("navigation", { name: "Operaciones de préstamos" }).getByRole("button", { name: "Refinanciaciones", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "Diego Puntual" })
    .getByRole("button", { name: "Ver préstamo", exact: true })
    .click();
  await sheet.getByText("Refinanciar un mes", { exact: true }).click();
  await expect(
    sheet.getByRole("button", {
      name: "Confirmar refinanciación",
      exact: true,
    }),
  ).toBeEnabled();
  page.once("dialog", (dialog) => dialog.accept());
  await sheet
    .getByRole("button", { name: "Confirmar refinanciación", exact: true })
    .click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1].name).toBe("refinance_loan");
  expect(calls[1].body.p_loan).toBe("loan-3");
  await expect(sheet.getByText(/Refinanciación registrada/)).toBeVisible();
});
test("cliente limpio despliega deuda e interés cobrado en la misma página, con WhatsApp y edición", async ({
  page,
}) => {
  await mockSupabase(page, "administrador", await dashboardFixtures());
  await login(page);
  await navigateModule(page, "Clientes");
  const ana = page.getByRole("article", { name: "Ana Socia", exact: true });
  await expect(ana).toContainText("S-01");
  await expect(ana).not.toContainText("12345670");
  await expect(ana.getByRole("region")).toHaveCount(0);
  await expect(
    ana.getByRole("link", { name: "WhatsApp de Ana Socia" }),
  ).toBeVisible();
  await expect(
    ana.locator('dl[aria-label="Resumen de Ana Socia"]'),
  ).toContainText("S/ 870.00");
  await expect(
    ana.locator('dl[aria-label="Resumen de Ana Socia"]'),
  ).toContainText("Interés cobrado (ganancia)");
  await ana.getByRole("button", { name: /^Ana Socia/ }).click();
  const region = ana.getByRole("region", { name: "Cuenta de Ana Socia" });
  await expect(region).toContainText("S/ 870.00");
  await expect(region).toContainText("12345670");
  await expect(region).toContainText("Interés cobrado (ganancia)");
  await region.getByText("Ver cuotas e historial", { exact: true }).click();
  await expect(region).toContainText("Periodo 1 · Cuota 1");
  await expect(
    page.getByRole("heading", { name: "Clientes", exact: true, level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: "Luis Trabajador", exact: true }),
  ).toBeVisible();
  const maria = page.getByRole("article", {
    name: "Maria Liquidada",
    exact: true,
  });
  await expect(
    maria.locator('dl[aria-label="Resumen de Maria Liquidada"]'),
  ).toContainText("S/ 60.00");
  await expect(
    maria.locator('dl[aria-label="Resumen de Maria Liquidada"]'),
  ).toContainText("S/ 0.00");
  await maria.getByRole("button", { name: /^Maria Liquidada/ }).click();
  await expect(region).toHaveCount(0);
  await expect(maria.getByRole("region")).toContainText("Liquidado");
  await expect(maria.getByRole("region").locator("dl").first()).toContainText(
    "S/ 60.00",
  );
  await expect(
    maria.getByRole("region").locator("dl").first(),
  ).not.toContainText("S/ 1,060.00");
  const luis = page.getByRole("article", {
    name: "Luis Trabajador",
    exact: true,
  });
  await luis.getByRole("button", { name: /^Luis Trabajador/ }).click();
  await expect(luis.getByRole("region")).toHaveClass(/client-account-danger/);
  const href = await luis
    .getByRole("link", { name: "WhatsApp de Luis Trabajador" })
    .getAttribute("href");
  const message = new URL(href!).searchParams.get("text")!;
  expect(message).toContain("Estado: En mora");
  expect(message).toContain("Días de atraso de la cuota: 7");
  expect(message).toContain("penalidades según las condiciones");
  expect(message).toContain("La Gerencia");
  await ana.getByRole("button", { name: /^Ana Socia/ }).click();
  const edit = ana.getByRole("button", { name: "Editar", exact: true });
  await edit.click();
  await expect(
    page.getByRole("dialog").getByLabel("Código de stand"),
  ).toHaveValue("S-01");
  await page.keyboard.press("Escape");
  await expect(edit).toBeFocused();
  await ana.getByRole("button", { name: /^Ana Socia/ }).click();
  await expect(ana.getByRole("region")).toHaveCount(0);
});

for (const dark of [false, true])
  test(`clientes desplegados sin desbordamiento a 375px, noche ${dark}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
    await mockSupabase(page, "jefe", await dashboardFixtures());
    await login(page);
    await navigateModule(page, "Clientes");
    const luis = page.getByRole("article", {
      name: "Luis Trabajador",
      exact: true,
    });
    await luis.getByRole("button", { name: /^Luis Trabajador/ }).click();
    await expect(luis.getByRole("region")).toHaveClass(/client-account-danger/);
    await expect(
      luis.getByRole("button", { name: "Editar", exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page.screenshot({
      path: `test-results/clients-375-${dark ? "dark" : "light"}.png`,
      fullPage: true,
    });
  });

test("formulario de cliente registra stand y condición con confirmación y feedback", async ({
  page,
}) => {
  const calls = await mockSupabase(page, "administrador");
  await login(page);
  await navigateModule(page, "Clientes");
  await page
    .getByRole("button", { name: "Nuevo cliente", exact: true })
    .click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Código de stand").fill("B-02");
  await sheet
    .getByRole("combobox", { name: "Condición", exact: true })
    .selectOption("trabajador");
  await sheet.getByLabel("Nombres y apellidos").fill("Elena Trabajadora");
  await sheet.getByLabel("DNI", { exact: true }).fill("87654321");
  await sheet.getByLabel("Celular / WhatsApp").fill("987654321");
  await sheet.getByLabel("Dirección").fill("Plaza Móvil 100");
  page.once("dialog", (dialog) => dialog.accept());
  await sheet
    .getByRole("button", { name: "Guardar cliente", exact: true })
    .click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0]).toMatchObject({
    name: "clients.insert",
    body: {
      stand_code: "B-02",
      member_type: "trabajador",
      full_name: "Elena Trabajadora",
      dni: "87654321",
    },
  });
  await expect(sheet).toHaveCount(0);
  await expect(
    page.getByText("Cliente guardado.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: "Elena Trabajadora", exact: true }),
  ).toContainText("B-02");
});

test("cobro de varias cuotas calcula pendientes parciales y liquidación completa", async ({
  page,
}) => {
  const fixtures = await dashboardFixtures();
  const { addDays } = await import("../src/lib/portal");
  const today = fixtures.payments[0].paid_on;
  fixtures.loans[0].capital_pending = 87000;
  fixtures.loans[0].interest_pending = 0;
  fixtures.installment_balances = fixtures.installment_balances.filter(
    (i) => i.loan_id !== "loan-0",
  );
  fixtures.installment_balances.push(
    ...[1, 2, 3, 4].map((number) => ({
      id: `ana-${number}`,
      loan_id: "loan-0",
      period_id: "period-0",
      number,
      due_date: addDays(today, (number - 2) * 7),
      scheduled_cents: 26500,
      paid_cents: number === 1 ? 19000 : 0,
      pending_cents: number === 1 ? 7500 : 26500,
      is_current: true,
      status: number === 1 ? "vencido" : "pendiente",
    })),
  );
  const calls = await mockSupabase(page, "administrador", fixtures);
  await login(page);
  await navigateModule(page, "Panel general");
  await page
    .getByRole("row")
    .filter({ hasText: "Ana Socia" })
    .getByRole("button", { name: "Ver detalle de Ana Socia", exact: true })
    .click();
  const sheet = page.getByRole("dialog");
  await sheet
    .getByRole("button", { name: "Pagar 1 cuota", exact: true })
    .click();
  await expect(sheet.getByLabel("Monto (S/)")).toHaveValue("75.00");
  await sheet
    .getByRole("button", { name: "Pagar 2 cuotas", exact: true })
    .click();
  await expect(sheet.getByLabel("Monto (S/)")).toHaveValue("340.00");
  await sheet
    .getByRole("button", { name: "Pagar 3 cuotas", exact: true })
    .click();
  await expect(sheet.getByLabel("Monto (S/)")).toHaveValue("605.00");
  await sheet
    .getByRole("button", { name: "Liquidar préstamo", exact: true })
    .click();
  await expect(sheet.getByLabel("Monto (S/)")).toHaveValue("870.00");
  page.once("dialog", (dialog) => dialog.accept());
  await sheet
    .getByRole("button", { name: "Confirmar pago", exact: true })
    .click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].body).toMatchObject({
    p_loan: "loan-0",
    p_amount: 87000,
    p_paid_on: today,
  });
});

test("recordatorio WhatsApp prepara estado, días de mora, advertencia y firma sin enviar mensajes", async ({
  page,
}) => {
  const calls = await mockSupabase(
    page,
    "administrador",
    await dashboardFixtures(),
  );
  await login(page);
  await navigateModule(page, "Panel general");
  await page
    .getByRole("button", {
      name: "Ver detalle de Luis Trabajador",
      exact: true,
    })
    .click();
  const link = page
    .getByRole("dialog")
    .getByRole("link", { name: "Recordar pago por WhatsApp", exact: true });
  const href = await link.getAttribute("href");
  const url = new URL(href!);
  const text = url.searchParams.get("text")!;
  expect(url.origin).toBe("https://wa.me");
  expect(url.pathname).toBe("/51999999999");
  expect(text).toContain("Estado de la cuota: En mora");
  expect(text).toContain("Días de atraso de esta cuota: 7 días");
  expect(text).toContain(
    "El atraso puede generar penalidades según las condiciones de tu préstamo.",
  );
  expect(text).toContain("Atentamente,\nLa Gerencia\nPM Créditos");
  expect(calls).toHaveLength(0);
});

for (const width of [375, 1440])
  test(`modo noche automático, paleta y formularios legibles a ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: "dark" });
    await mockSupabase(page, "administrador", await dashboardFixtures());
    await login(page);
    expect(
      await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      ),
    ).toBe("rgb(20, 17, 23)");
    const card = page.locator("article.surface").first();
    expect(
      await card.evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe("rgb(33, 28, 38)");
    await navigateModule(page, "Reportes");
    const exporter = page.getByRole("button", {
      name: "Exportar Excel completo",
      exact: true,
    });
    expect(
      await exporter.evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe("rgb(78, 184, 82)");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page.screenshot({
      path: `test-results/night-${width}.png`,
      fullPage: true,
    });
    await navigateModule(page, "Clientes");
    await page
      .getByRole("button", { name: "Nuevo cliente", exact: true })
      .click();
    const field = page.getByRole("dialog").getByLabel("Código de stand");
    expect(
      await field.evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe("rgb(33, 28, 38)");
    await page.keyboard.press("Escape");
    await navigateModule(page, "Configuración");
    await expect(
      page.getByText("Automática · según el dispositivo", { exact: true }),
    ).toBeVisible();
    await page.emulateMedia({ colorScheme: "light" });
    expect(
      await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      ),
    ).toBe("rgb(247, 246, 249)");
  });
test("Excel completo se descarga, abre como XLSX y conserva datos, cuotas y pagos", async ({
  page,
}) => {
  await mockSupabase(page, "administrador", await dashboardFixtures());
  await login(page);
  await navigateModule(page, "Reportes");
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Panel de cobranza Excel", exact: true })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("pm-creditos-general.xlsx");
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile((await download.path())!);
  expect(book.getWorksheet("Cartera")!.rowCount).toBe(5);
  expect(book.getWorksheet("Cartera")!.getCell("F2").value).toBe("Ana Socia");
  expect(book.getWorksheet("Pagos")!.rowCount).toBe(2);
  expect(book.getWorksheet("Cuotas")!.rowCount).toBe(5);
  await page
    .getByRole("combobox", { name: "Filtrar condición" })
    .selectOption("trabajador");
  const filteredPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Panel de cobranza Excel", exact: true })
    .click();
  const filtered = await filteredPromise;
  const other = new ExcelJS.Workbook();
  await other.xlsx.readFile((await filtered.path())!);
  expect(other.getWorksheet("Cartera")!.rowCount).toBe(2);
  expect(other.getWorksheet("Cartera")!.getCell("F2").value).toBe(
    "Luis Trabajador",
  );
});

test("periodo terminado prioriza liquidación urgente en panel, cliente, WhatsApp y Excel", async ({
  page,
}) => {
  const fixtures = await dashboardFixtures();
  const { limaDate, addDays } = await import("../src/lib/portal");
  const today = limaDate();
  fixtures.loan_periods[0].start_date = addDays(today, -29);
  fixtures.loan_periods[0].end_date = addDays(today, -1);
  fixtures.installment_balances[0].due_date = addDays(today, -1);
  fixtures.installment_balances[0].number = 4;
  await mockSupabase(page, "administrador", fixtures);
  await login(page);
  await navigateModule(page, "Panel general");
  const table = page.getByRole("table", { name: "Panel general de préstamos" });
  await expect(table.getByRole("row").nth(1)).toContainText("Ana Socia");
  const ana = table.getByRole("row").filter({ hasText: "Ana Socia" });
  await expect(ana).toContainText("Liquidación urgente");
  await expect(ana).not.toContainText("En mora");
  await page
    .getByRole("combobox", { name: "Filtrar estado" })
    .selectOption("Liquidación urgente");
  await expect(table.getByRole("row")).toHaveCount(2);
  await ana
    .getByRole("button", { name: "Ver detalle de Ana Socia", exact: true })
    .click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("Puedes liquidar el préstamo o refinanciarlo");
  const href = await sheet
    .getByRole("link", { name: "Recordar pago por WhatsApp" })
    .getAttribute("href");
  const text = new URL(href!).searchParams.get("text")!;
  expect(text).toContain("Liquidación urgente");
  expect(text).toMatch(/100 % del saldo restante: S\/\s*870\.00/);
  expect(text).not.toContain("En mora");
  await sheet
    .getByRole("button", { name: "Liquidar préstamo", exact: true })
    .click();
  await expect(sheet.getByLabel("Monto (S/)")).toHaveValue("870.00");
  await page.keyboard.press("Escape");
  await navigateModule(page, "Reportes");
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Panel de cobranza Excel", exact: true })
    .click();
  const download = await downloadPromise;
  const ExcelJS = await import("exceljs");
  const book = new ExcelJS.default.Workbook();
  await book.xlsx.readFile((await download.path())!);
  const cartera = book.getWorksheet("Cartera")!;
  const stateColumn = (cartera.getRow(1).values as string[]).findIndex(
    (v) => v === "ESTADO",
  );
  expect(cartera.getCell(2, stateColumn).value).toBe("Liquidación urgente");
  await navigateModule(page, "Clientes");
  const client = page.getByRole("article", { name: "Ana Socia", exact: true });
  await client.getByRole("button", { name: /^Ana Socia/ }).click();
  await expect(client.getByRole("region")).toContainText("Liquidación urgente");
  await expect(client.getByRole("region")).toHaveClass(/client-account-danger/);
  const clientHref = await client
    .getByRole("link", { name: "WhatsApp de Ana Socia" })
    .getAttribute("href");
  expect(new URL(clientHref!).searchParams.get("text")).toContain(
    "100 % del saldo restante",
  );
});

for (const width of [375, 1440])
  test(`panel resalta vencimientos de hoy a ${width}px, conserva mora y modo noche`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
    await mockSupabase(page, "administrador", await dashboardFixtures());
    await login(page);
    await navigateModule(page, "Panel general");
    const table = page.getByRole("table", {
      name: "Panel general de préstamos",
    });
    const ana = table.getByRole("row").filter({ hasText: "Ana Socia" });
    const maria = table.getByRole("row").filter({ hasText: "Maria Liquidada" });
    const luis = table.getByRole("row").filter({ hasText: "Luis Trabajador" });
    await expect(ana).toHaveClass(/payment-due-today/);
    await expect(ana).toContainText("Vence hoy");
    await expect(maria).not.toHaveClass(/payment-due-today/);
    await expect(maria).not.toContainText("Vence hoy");
    await expect(luis).not.toHaveClass(/payment-due-today/);
    await expect(luis).toContainText("En mora");
    await expect(table.locator("thead th")).toHaveCount(6);
    const light = await ana.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(light).toBe("rgb(243, 235, 247)");
    await page.screenshot({
      path: `test-results/due-today-${width}-light.png`,
      fullPage: true,
    });
    await page.emulateMedia({ colorScheme: "dark" });
    expect(
      await ana.evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe("rgb(53, 36, 63)");
    await page.screenshot({
      path: `test-results/due-today-${width}-dark.png`,
      fullPage: true,
    });
  });

for (const width of [375, 1440])
  test(`botón día y noche conserva preferencia y permite volver al dispositivo a ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: "dark" });
    await mockSupabase(page, "administrador", await dashboardFixtures());
    await login(page);
    const color = () =>
      page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await expect(
      page.getByRole("button", { name: "Activar modo día", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Activar modo día", exact: true })
      .click();
    expect(await color()).toBe("rgb(247, 246, 249)");
    expect(
      await page.evaluate(() => localStorage.getItem("pm-creditos-theme")),
    ).toBe("light");
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Activar modo noche", exact: true }),
    ).toBeVisible();
    expect(await color()).toBe("rgb(247, 246, 249)");
    await page
      .getByRole("button", { name: "Activar modo noche", exact: true })
      .click();
    expect(await color()).toBe("rgb(20, 17, 23)");
    await page.emulateMedia({ colorScheme: "light" });
    expect(await color()).toBe("rgb(20, 17, 23)");
    await navigateModule(page, "Clientes");
    await page
      .getByRole("button", { name: "Nuevo cliente", exact: true })
      .click();
    expect(
      await page
        .getByRole("dialog")
        .getByLabel("Código de stand")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe("rgb(33, 28, 38)");
    await page.keyboard.press("Escape");
    await navigateModule(page, "Configuración");
    await expect(page.getByText("Modo noche", { exact: true })).toBeVisible();
    await page
      .getByRole("button", {
        name: "Usar configuración del dispositivo",
        exact: true,
      })
      .click();
    await expect(
      page.getByText("Automática · según el dispositivo", { exact: true }),
    ).toBeVisible();
    expect(await color()).toBe("rgb(247, 246, 249)");
    expect(
      await page.evaluate(() => localStorage.getItem("pm-creditos-theme")),
    ).toBeNull();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page
      .getByRole("button", { name: "Activar modo noche", exact: true })
      .click();
    await page.screenshot({
      path: `test-results/theme-toggle-${width}.png`,
      fullPage: true,
    });
  });

test("el botón de apariencia también funciona al ingresar, con almacenamiento bloqueado", async ({
  page,
}) => {
  await mockSupabase(page, "administrador");
  await page.addInitScript(() => {
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === "pm-creditos-theme")
        throw new DOMException("Storage blocked", "SecurityError");
      Object.defineProperty(this, key, { value, configurable: true });
    };
  });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Activar modo noche", exact: true })
    .click();
  expect(
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
  ).toBe("rgb(20, 17, 23)");
  await page
    .getByRole("button", { name: "Activar modo día", exact: true })
    .click();
  expect(
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
  ).toBe("rgb(247, 246, 249)");
});

for (const width of [375, 1440]) {
  test(`navegación agrupada conserva refinanciaciones y búsqueda única a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockSupabase(page, "administrador", await dashboardFixtures());
    await login(page);
    await navigateModule(page, "Préstamos");
    const operations = page.getByRole("navigation", { name: "Operaciones de préstamos" });
    await expect(operations).toBeVisible();
    await expect(page.getByRole("searchbox")).toHaveCount(1);
    await page.getByRole("searchbox").fill("Diego");
    await operations.getByRole("button", { name: "Refinanciaciones", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Historial de refinanciaciones" })).toBeVisible();
    await expect(page.getByRole("searchbox")).toHaveValue("Diego");
    await expect(operations.getByRole("button", { name: "Refinanciaciones", exact: true })).toHaveAttribute("aria-current", "page");
    if (width < 1024) await page.getByRole("button", { name: "Abrir menú" }).click();
    const mainMenu = page.getByRole("navigation", { name: "Menú principal" }).filter({ visible: true });
    await expect(mainMenu.getByRole("button", { name: "Refinanciaciones", exact: true })).toHaveCount(0);
    await expect(mainMenu.getByRole("button", { name: "Préstamos", exact: true })).toHaveAttribute("aria-current", "page");
    if (width < 1024) await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Limpiar búsqueda", exact: true }).click();
    await expect(page.getByRole("searchbox")).toHaveValue("");
    await page.screenshot({ path: `test-results/navigation-after-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Activar modo noche" }).click();
    await expect.poll(() => page.getByRole("button", { name: "Actualizar", exact: true }).evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgb(33, 28, 38)");
    await page.screenshot({ path: `test-results/navigation-after-dark-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  });
}


for (const width of [375, 1440]) {
  test(`inicio operativo con seis módulos y agenda completa a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const fixtures = await dashboardFixtures();
    const { limaDate, addDays } = await import("../src/lib/portal");
    const today = limaDate();
    fixtures.installment_balances[0].due_date = addDays(today, -2);
    fixtures.installment_balances[3].due_date = addDays(today, 3);
    await mockSupabase(page, "administrador", fixtures);
    await login(page);
    await expect(page.getByRole("heading", { name: "Inicio", exact: true })).toBeVisible();
    await expect(page.getByText("Capital prestado", { exact: true })).not.toBeVisible();
    await page.getByRole("button", { name: "Vencidos", exact: true }).click();
    const agenda = page.getByRole("table", { name: "Cronograma de cobros" });
    await expect(agenda).toContainText("Ana Socia");
    await expect(agenda).not.toContainText("Diego Puntual");
    await page.getByRole("button", { name: "Próximos 7 días", exact: true }).click();
    await expect(agenda).toContainText("Diego Puntual");
    await expect(agenda).not.toContainText("Ana Socia");
    await page.getByRole("button", { name: "Esta semana", exact: true }).click();
    await expect(page.getByRole("button", { name: "Exportar Excel completo" })).toHaveCount(0);
    if (width < 1024) await page.getByRole("button", { name: "Abrir menú" }).click();
    const menu = page.getByRole("navigation", { name: "Menú principal" }).filter({ visible: true });
    await expect(menu.getByRole("button")).toHaveCount(6);
    if (width < 1024) await page.keyboard.press("Escape");
    await page.mouse.move(0, 0);
    await expect(page.getByRole("button", { name: "Esta semana", exact: true })).toHaveCSS("background-color", "rgb(78, 184, 82)");
    await page.screenshot({ path: `test-results/inicio-operativo-${width}.png`, fullPage: true });
    await navigateModule(page, "Préstamos");
    await expect(page.getByRole("table", { name: "Panel general de préstamos" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Cartera de préstamos", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Nuevo préstamo", exact: true }).click();
    await expect(page.getByLabel("Monto del préstamo (S/)", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    await navigateModule(page, "Configuración");
    await page.getByRole("button", { name: "Revisar Excel", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Configuración", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
}

test("consulta sin permisos recibe cambios Realtime y conserva controles de solo lectura", async ({ page }) => {
  const fixtures = await dashboardFixtures();
  const sockets: { socket: import('@playwright/test').WebSocketRoute; topic: string; ids: number[] }[] = [];
  await page.routeWebSocket(/wss:\/\/pm-e2e\.supabase\.co\/.*/, socket => {
    socket.onMessage(raw => {
      const [join_ref, ref, topic, event, payload] = JSON.parse(String(raw));
      const message = { join_ref, ref, topic, event, payload };
      if (message.event !== "phx_join") return;
      const changes = message.payload.config.postgres_changes.map((change: Record<string, unknown>, index: number) => ({ ...change, id: index + 1 }));
      sockets.push({ socket, topic: message.topic, ids: changes.map((change: { id: number }) => change.id) });
      socket.send(JSON.stringify([message.join_ref, message.ref, message.topic, "phx_reply", { status: "ok", response: { postgres_changes: changes } }]));
    });
  });
  const calls = await mockSupabase(page, "jefe", fixtures);
  await login(page);
  await expect.poll(() => sockets.length).toBeGreaterThan(0);
  await expect(page.getByText("S/ 2,430.00", { exact: true })).toBeVisible();
  fixtures.loans[0].capital_pending = 71000;
  for (const { socket, topic, ids } of sockets) socket.send(JSON.stringify([null, null, topic, "postgres_changes", { ids, data: { schema: "public", table: "loans", type: "UPDATE", commit_timestamp: new Date().toISOString(), columns: [], record: fixtures.loans[0], old_record: {}, errors: null } }]));
  await expect(page.getByText("S/ 2,330.00", { exact: true })).toBeVisible();
  await navigateModule(page, "Préstamos");
  await expect(page.getByRole("button", { name: "Nuevo préstamo" })).toHaveCount(0);
  await page.getByRole("button", { name: "Ver detalle de Ana Socia", exact: true }).click();
  const detail = page.getByRole("dialog");
  await expect(detail.getByRole("button", { name: /Confirmar pago|Confirmar refinanciación|Liquidar préstamo/ })).toHaveCount(0);
  expect(calls).toHaveLength(0);
});

test("consulta actualiza saldos cada 30 segundos aunque Realtime no esté habilitado", async ({ page }) => {
  await page.clock.install();
  const fixtures = await dashboardFixtures();
  const calls = await mockSupabase(page, "jefe", fixtures);
  await login(page);
  await expect(page.getByText("S/ 2,430.00", { exact: true })).toBeVisible();
  fixtures.loans[0].capital_pending = 61000;
  await page.clock.fastForward(31000);
  await page.clock.runFor(500);
  await expect(page.getByText("S/ 2,230.00", { exact: true })).toBeVisible();
  expect(calls).toHaveLength(0);
});


for (const role of ["administrador", "jefe"] as const) {
  for (const width of [375, 1440]) {
    test(`Panel general vuelve al menú para ${role} a ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await mockSupabase(page, role, await dashboardFixtures());
      await login(page);
      await navigateModule(page, "Panel general");
      await expect(page.getByRole("heading", { name: "Panel general", exact: true })).toBeVisible();
      const table = page.getByRole("table", { name: "Panel general de préstamos" });
      await expect(table.getByRole("columnheader")).toHaveText(["Prestatario", "Fecha del préstamo", "Día de pago", "Saldo", "Cuota semanal", "Estado"]);
      await expect(page.getByRole("button", { name: "Nuevo préstamo", exact: true })).toHaveCount(0);
      await table.getByRole("button", { name: "Ver detalle de Ana Socia", exact: true }).click();
      await expect(page.getByRole("dialog")).toContainText("Ana Socia");
      await page.keyboard.press("Escape");
      if (width < 1024) await page.getByRole("button", { name: "Abrir menú" }).click();
      await expect(page.getByRole("navigation", { name: "Menú principal" }).filter({ visible: true }).getByRole("button", { name: "Panel general", exact: true })).toHaveAttribute("aria-current", "page");
      if (width < 1024) await page.keyboard.press("Escape");
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    });
  }
}


for (const width of [375, 1440]) {
  test(`refinancia vencidos después del periodo con interés pagado a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const fixtures = await dashboardFixtures();
    const { limaDate, addDays } = await import("../src/lib/portal");
    const today = limaDate();
    fixtures.loan_periods[1].end_date = addDays(today, -1);
    const calls = await mockSupabase(page, "administrador", fixtures);
    await login(page);
    await navigateModule(page, "Panel general");
    await page.getByRole("button", { name: "Ver detalle de Luis Trabajador", exact: true }).click();
    const detail = page.getByRole("dialog");
    await detail.getByText("Refinanciar un mes", { exact: true }).click();
    await expect(detail.getByText("Hay cuotas vencidas pendientes de pago.")).toHaveCount(0);
    const confirm = detail.getByRole("button", { name: "Confirmar refinanciación", exact: true });
    await expect(confirm).toBeEnabled();
    page.once("dialog", dialog => dialog.accept());
    await confirm.click();
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0].name).toBe("refinance_loan");
    expect(calls[0].body.p_loan).toBe("loan-1");
    expect(calls[0].body.p_request).toMatch(/^[0-9a-f-]{36}$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
}

for (const endOffset of [0, 1]) {
  test(`refinanciación bloqueada cuando faltan ${endOffset} días para terminar el periodo`, async ({ page }) => {
    const fixtures = await dashboardFixtures();
    const { limaDate, addDays } = await import("../src/lib/portal");
    fixtures.loan_periods[1].end_date = addDays(limaDate(), endOffset);
    const calls = await mockSupabase(page, "administrador", fixtures);
    await login(page);
    await navigateModule(page, "Panel general");
    await page.getByRole("button", { name: "Ver detalle de Luis Trabajador", exact: true }).click();
    const detail = page.getByRole("dialog");
    await detail.getByText("Refinanciar un mes", { exact: true }).click();
    await expect(detail.getByText(/El periodo aún no ha terminado/)).toBeVisible();
    await expect(detail.getByRole("button", { name: "Confirmar refinanciación", exact: true })).toBeDisabled();
    expect(calls).toHaveLength(0);
  });
}


for (const [amount, months, rate, interest, quota] of [[250,1,700,17.5,66.88],[500,2,700,70,71.25],[1500,1,600,90,397.5]] as const) {
  test(`monto libre ${amount} a ${months} meses usa tasa automática y confirma datos`, async ({ page }) => {
    const calls = await mockSupabase(page, "administrador");
    await login(page);
    await navigateModule(page, "Préstamos");
    await page.getByRole("button", { name: "Nuevo préstamo", exact: true }).click();
    await page.getByLabel("Monto del préstamo (S/)", { exact: true }).fill(String(amount));
    await page.getByLabel("Plazo del préstamo", { exact: true }).selectOption(String(months));
    await expect(page.getByText("Tasa mensual:")).toContainText(`${rate/100} %`);
    await page.getByRole("button", { name: "Revisar cronograma" }).click();
    await expect(page.getByText(/Capital: S\//)).toContainText(`Interés: S/ ${interest.toFixed(2)}`);
    await expect(page.getByText(new RegExp(`Cuota ${months*4} ·`))).toContainText(`S/ ${quota.toFixed(2)}`);
    await page.getByRole("combobox", { name: "Cliente", exact: true }).selectOption(clientId);
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "Confirmar desembolso", exact: true }).click();
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0].body).toMatchObject({p_capital:amount*100,p_rate:rate,p_months:months});
  });
}

test("monto o plazo nuevo invalida el cronograma antes de desembolsar", async ({ page }) => {
  const calls = await mockSupabase(page, "administrador");
  await login(page);
  await navigateModule(page, "Préstamos");
  await page.getByRole("button", { name: "Nuevo préstamo", exact: true }).click();
  const amount = page.getByLabel("Monto del préstamo (S/)", { exact: true });
  await amount.fill("1500");
  await page.getByRole("button", { name: "Revisar cronograma" }).click();
  await expect(page.getByRole("button", { name: "Confirmar desembolso" })).toBeVisible();
  await amount.fill("500");
  await expect(page.getByRole("button", { name: "Confirmar desembolso" })).toHaveCount(0);
  await page.getByRole("button", { name: "Revisar cronograma" }).click();
  await page.getByLabel("Plazo del préstamo", { exact: true }).selectOption("2");
  await expect(page.getByRole("button", { name: "Confirmar desembolso" })).toHaveCount(0);
  expect(calls).toHaveLength(0);
});


test("servidor antiguo explica que falta aplicar la actualización de Supabase", async ({ page }) => {
  const fixtures = await dashboardFixtures();
  const { limaDate, addDays } = await import("../src/lib/portal");
  fixtures.loan_periods[1].end_date = addDays(limaDate(), -1);
  await mockSupabase(page, "administrador", fixtures);
  await page.route("https://pm-e2e.supabase.co/rest/v1/rpc/refinance_loan", route => route.request().method() === "OPTIONS" ? route.fallback() : route.fulfill({status:400,contentType:"application/json",headers:{"access-control-allow-origin":"*"},body:JSON.stringify({message:"Cuotas vencidas pendientes",code:"P0001"})}));
  await login(page);
  await navigateModule(page, "Panel general");
  await page.getByRole("button", { name: "Ver detalle de Luis Trabajador", exact: true }).click();
  const detail = page.getByRole("dialog");
  await detail.getByText("Refinanciar un mes", { exact: true }).click();
  page.once("dialog", dialog => dialog.accept());
  await detail.getByRole("button", { name: "Confirmar refinanciación", exact: true }).click();
  await expect(detail.getByText(/Actualización de Supabase pendiente/)).toBeVisible();
  await expect(detail.getByRole("link", { name: "Abrir actualización SQL 006" })).toHaveAttribute("href", /202610150006_flexible_loans_and_refinancing.sql$/);
});
