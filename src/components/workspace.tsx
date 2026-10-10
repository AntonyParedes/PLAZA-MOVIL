"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import {
  ShieldCheck,
  Plus,
  ArrowRight,
  Wallet,
  CalendarDays,
  Settings,
} from "lucide-react";
import AppShell, { Brand, type Section } from "@/components/app-shell";
import {
  Badge,
  Card,
  ClientSearch,
  EmptyState,
  LoadingSkeleton,
  Notice,
  SectionHeading,
  Sheet,
} from "@/components/ui/dashboard";
import { useLiveRevision } from "@/hooks/use-live-revision";
import { getSupabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import FinancialWorkspace from "@/components/financial-workspace";
import ClientDirectory from "@/components/client-directory";
import { ThemeToggle, ThemePreference } from "@/components/theme-toggle";
import ImportReview from "@/components/import-review";

type Client = {
  id: string;
  full_name: string;
  dni: string;
  phone: string;
  address: string;
  notes: string | null;
  created_at: string;
  stand_code: string | null;
  member_type: "socio" | "trabajador" | null;
};
const clientSchema = z.object({
  stand_code: z.string().trim().min(1).max(40),
  member_type: z.enum(["socio", "trabajador"]),
  full_name: z.string().trim().min(3).max(150),
  dni: z.string().regex(/^\d{8}$/),
  phone: z.string().regex(/^9\d{8}$/),
  address: z.string().trim().min(3).max(300),
  notes: z.string().trim().max(2000),
});
const supabase = getSupabase();
export default function Workspace() {
  const [userId, setUserId] = useState<string | null>(null);
  const sessionUserId = useRef<string | null>(null);
  const [role, setRole] = useState<"administrador" | "jefe" | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState("");
  const liveRevision = useLiveRevision(Boolean(userId));
  const [section, setSection] = useState<Section>("dashboard");
  const [memberFilter, setMemberFilter] = useState("todos");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      const nextUserId = session?.user.id ?? null;
      // SIGNED_IN can repeat when a tab regains focus; TOKEN_REFRESHED also keeps the same user.
      // Clear user data only when identity changes or the session actually ends.
      if (nextUserId !== sessionUserId.current) {
        sessionUserId.current = nextUserId;
        setUserId(nextUserId);
        setRole(null);
        setClients([]);
        setMessage("");
        setShowForm(false);
        setEditing(null);
        setSearch("");
        setMemberFilter("todos");
        setSection("dashboard");
      }
      setLoading(false);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (!userId || !supabase) return;
    let active = true;
    async function load() {
      const profile = await supabase!
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single();
      if (!active) return;
      if (
        profile.error ||
        !["administrador", "jefe"].includes(profile.data?.role)
      ) {
        setRole(null);
        setMessage(
          "Tu usuario no tiene un rol autorizado. Solicita al responsable que te asigne un perfil.",
        );
        return;
      }
      setRole(profile.data.role);
      const rows: Client[] = [];
      for (let offset = 0; ; offset += 1000) {
        const result = await supabase!
          .from("clients")
          .select("*")
          .order("created_at", { ascending: false })
          .order("id")
          .range(offset, offset + 999);
        if (!active) return;
        if (result.error) {
          setMessage(
            "No se pudieron cargar clientes. Verifica la migración y los permisos de Supabase.",
          );
          return;
        }
        rows.push(...result.data);
        if (result.data.length < 1000) break;
      }
      setClients(rows);
      setMessage("");
    }
    void load();
    return () => {
      active = false;
    };
  }, [userId, liveRevision]);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const data = new FormData(event.currentTarget);
    try {
      const result = await supabase!.auth.signInWithPassword({
        email: String(data.get("email")),
        password: String(data.get("password")),
      });
      if (result.error)
        setMessage(
          "No fue posible ingresar. Verifica tus credenciales y la conexión.",
        );
    } catch {
      setMessage("No se pudo conectar con Supabase.");
    } finally {
      setBusy(false);
    }
  }
  async function createClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (role !== "administrador") return;
    const form = event.currentTarget;
    const parsed = clientSchema.safeParse(
      Object.fromEntries(new FormData(form)),
    );
    if (!parsed.success) {
      setMessage(
        "Completa código de stand, condición, DNI de 8 dígitos y celular peruano de 9 dígitos.",
      );
      return;
    }
    if (
      !window.confirm(
        `¿${editing ? "Actualizar" : "Registrar"} a ${parsed.data.full_name} con DNI ${parsed.data.dni}?`,
      )
    )
      return;
    setBusy(true);
    setMessage("");
    try {
      const query = editing
        ? supabase!.from("clients").update(parsed.data).eq("id", editing.id)
        : supabase!.from("clients").insert(parsed.data);
      const result = await query.select("*").single();
      if (result.error)
        setMessage(
          result.error.code === "23505"
            ? "Ya existe un cliente con ese DNI."
            : "No se pudo registrar el cliente. Verifica tu conexión y permisos.",
        );
      else {
        setClients((current) =>
          editing
            ? current.map((c) => (c.id === editing.id ? result.data : c))
            : [result.data, ...current],
        );
        setShowForm(false);
        setEditing(null);
        form.reset();
        setMessage("Cliente guardado.");
      }
    } catch {
      setMessage("No se pudo conectar con Supabase.");
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    const result = await supabase!.auth.signOut();
    if (result.error) {
      setMessage("No se pudo cerrar sesión. Inténtalo nuevamente.");
      return;
    }
    setUserId(null);
    setRole(null);
    setClients([]);
    setMessage("");
    setShowForm(false);
  }
  const visible = clients.filter(
    (client) =>
      `${client.full_name} ${client.dni} ${client.stand_code ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (memberFilter === "todos" || client.member_type === memberFilter),
  );
  function navigate(next: Section) {
    setSection(next);
  }
  const notice = message && (
    <Notice error={message !== "Cliente guardado."}>{message}</Notice>
  );
  if (loading || (userId && !role && !message))
    return (
      <div className="mx-auto max-w-6xl p-6 sm:p-12">
        <Brand />
        <div className="mt-10">
          <LoadingSkeleton label="Verificando sesión…" />
        </div>
      </div>
    );
  if (!userId || !role || !supabase)
    return (
      <div className="min-h-screen lg:grid lg:grid-cols-2">
        <aside className="app-navigation flex flex-col justify-between bg-[var(--navy)] p-7 text-white sm:p-12 lg:p-16">
          <Brand />
          <div className="py-10 lg:py-20">
            <Badge tone="info">Plaza Móvil</Badge>
            <h1 className="mt-6 max-w-lg text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
              Tus créditos, pagos y clientes.
              <br />
              <span className="text-blue-300">Todo en un solo lugar.</span>
            </h1>
            <p className="mt-5 max-w-md text-sm leading-7 text-slate-300">
              Una vista clara de tu cartera para gestionar préstamos y acompañar
              cada pago.
            </p>
            <div className="mt-8 grid max-w-lg gap-3 sm:grid-cols-3">
              {[
                [Wallet, "Créditos"],
                [CalendarDays, "Pagos y saldos"],
                [ShieldCheck, "Acceso por rol"],
              ].map(([Icon, text]) => {
                const ItemIcon = Icon as typeof Wallet;
                return (
                  <div
                    key={String(text)}
                    className="rounded-xl border border-white/10 p-4"
                  >
                    <ItemIcon size={20} className="mb-3 text-blue-300" />
                    <p className="text-xs text-slate-200">{String(text)}</p>
                  </div>
                );
              })}
            </div>
          </div>
          <p className="text-xs text-slate-400">
            PM Créditos · Soles peruanos · Lima
          </p>
        </aside>
        <main className="flex items-center justify-center p-6 sm:p-12">
          <div className="w-full max-w-md space-y-6">
            <div className="flex justify-end">
              <ThemeToggle />
            </div>
            {notice}
            {!supabase ? (
              <Card>
                <ShieldCheck className="mb-4 text-blue-600" size={30} />
                <SectionHeading
                  title="Conecta tu proyecto Supabase"
                  description="Configura la URL y la clave publicable del proyecto para habilitar el acceso."
                />
              </Card>
            ) : userId ? (
              <Card>
                <EmptyState
                  title="Perfil no autorizado"
                  description="Solicita al responsable un perfil autorizado para acceder a los datos."
                  action={
                    <Button variant="outline" onClick={logout}>
                      Cerrar sesión
                    </Button>
                  }
                />
              </Card>
            ) : (
              <>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-blue-600">
                    Bienvenido a PM Créditos
                  </p>
                  <h2 className="mt-3 text-3xl font-semibold tracking-tight">
                    Iniciar sesión
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-slate-500">
                    Ingresa a tu espacio de trabajo con tu cuenta autorizada.
                  </p>
                </div>
                <form onSubmit={login} className="surface space-y-5 p-6 sm:p-8">
                  <label>
                    Correo electrónico
                    <input
                      name="email"
                      type="email"
                      placeholder="tu@correo.com"
                      autoComplete="username"
                      required
                    />
                  </label>
                  <label>
                    Contraseña
                    <input
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      required
                    />
                  </label>
                  <Button className="w-full" disabled={busy}>
                    {busy ? "Ingresando…" : "Ingresar"}
                    <ArrowRight size={16} />
                  </Button>
                </form>
                <p className="flex items-center justify-center gap-2 text-xs text-slate-500">
                  <ShieldCheck size={15} /> Acceso exclusivo para usuarios
                  autorizados
                </p>
              </>
            )}
          </div>
        </main>
      </div>
    );
  return (
    <AppShell
      section={section}
      onNavigate={navigate}
      role={role}
      onLogout={logout}
    >
      {notice}
      {section === "importar" && role === "administrador" ? (
        <ImportReview />
      ) : section === "configuracion" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <SectionHeading
              title="Tu espacio de trabajo"
              description="Preferencias de operación de PM Créditos."
            />
            <div className="mb-5">
              <ThemePreference />
            </div>
            <dl className="space-y-5 text-sm">
              {[
                ["Moneda", "Sol peruano (PEN)"],
                ["Zona horaria", "América / Lima"],
                ["Idioma", "Español"],
                ["Frecuencia de pago", "Semanal · 4 cuotas por mes"],
              ].map(([key, value]) => (
                <div
                  key={key}
                  className="flex flex-wrap justify-between gap-3 border-b border-slate-100 pb-4"
                >
                  <dt className="text-slate-500">{key}</dt>
                  <dd className="font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card>
            <Settings size={24} className="mb-4 text-blue-600" />
            <SectionHeading title="Acceso y operaciones" />
            <div className="space-y-4 text-sm leading-6 text-slate-600">
              <p>
                Tu perfil: <Badge tone="info">{role}</Badge>
              </p>
              <p>
                {role === "administrador"
                  ? "Puedes registrar clientes, desembolsar préstamos, registrar pagos y refinanciar."
                  : "Puedes consultar clientes, préstamos, cobros e informes."}
              </p>
              <p>
                Los pagos registrados son definitivos. Un préstamo puede
                liquidarse o refinanciarse conforme a las condiciones acordadas.
              </p>
              <p className="rounded-xl bg-slate-50 p-4">
                La configuración de la cuenta y los roles se gestiona por el
                responsable del sistema.
              </p>
            </div>
          </Card>
        </div>
      ) : section !== "clientes" ? (
        <>
          <FinancialWorkspace
            clients={clients}
            role={role}
            view={
              section === "dashboard"
                ? "resumen"
                : section === "importar"
                  ? "general"
                  : section
            }
            search={search}
            onSearchChange={setSearch}
          />
        </>
      ) : (
        <>
          <SectionHeading
            title="Tu comunidad de clientes"
            description="Encuentra un cliente por nombre, DNI o código de stand."
            action={
              role === "administrador" && (
                <Button
                  onClick={() => {
                    setEditing(null);
                    setShowForm(true);
                  }}
                >
                  <Plus size={17} /> Nuevo cliente
                </Button>
              )
            }
          />
          <Card className="!p-4">
            <div className="grid items-end gap-4 sm:grid-cols-[1fr_220px]">
              <ClientSearch value={search} onChange={setSearch} label="Buscar cliente" accessibleLabel="Buscar por nombre o DNI" />
              <label>
                Condición
                <select
                  aria-label="Filtrar clientes por condición"
                  value={memberFilter}
                  onChange={(e) => setMemberFilter(e.target.value)}
                >
                  <option value="todos">Todas las condiciones</option>
                  <option value="socio">Socio</option>
                  <option value="trabajador">Trabajador</option>
                </select>
              </label>
            </div>
          </Card>
          <p className="text-xs text-slate-500">
            {visible.length} {visible.length === 1 ? "cliente" : "clientes"}{" "}
            encontrados
          </p>
          <ClientDirectory
            clients={visible}
            role={role}
            onEdit={(client) => {
              setEditing(client);
              setShowForm(true);
            }}
          />
          <Sheet
            open={showForm && role === "administrador"}
            onOpenChange={setShowForm}
            title={editing ? "Editar cliente" : "Registrar cliente"}
            description="Identificación y datos de contacto del cliente."
          >
            <form
              key={editing?.id ?? "nuevo"}
              onSubmit={createClient}
              className="space-y-7"
            >
              <fieldset className="grid gap-5 sm:grid-cols-2">
                <legend className="mb-4 text-sm font-semibold text-slate-900">
                  Identificación
                </legend>
                <label>
                  Código de stand
                  <input
                    name="stand_code"
                    defaultValue={editing?.stand_code ?? ""}
                    required
                    maxLength={40}
                    placeholder="Ej. A-01"
                  />
                </label>
                <label>
                  Condición
                  <select
                    name="member_type"
                    defaultValue={editing?.member_type ?? ""}
                    required
                  >
                    <option value="">Selecciona socio o trabajador</option>
                    <option value="socio">Socio</option>
                    <option value="trabajador">Trabajador</option>
                  </select>
                </label>
                <label>
                  Nombres y apellidos
                  <input
                    name="full_name"
                    defaultValue={editing?.full_name ?? ""}
                    required
                    minLength={3}
                    maxLength={150}
                  />
                </label>
                <label>
                  DNI
                  <input
                    name="dni"
                    defaultValue={editing?.dni ?? ""}
                    required
                    inputMode="numeric"
                    pattern="[0-9]{8}"
                    maxLength={8}
                  />
                </label>
              </fieldset>
              <fieldset className="grid gap-5 sm:grid-cols-2">
                <legend className="mb-4 text-sm font-semibold text-slate-900">
                  Contacto
                </legend>
                <label>
                  Celular / WhatsApp
                  <input
                    name="phone"
                    defaultValue={editing?.phone ?? ""}
                    required
                    inputMode="tel"
                    pattern="9[0-9]{8}"
                    maxLength={9}
                  />
                </label>
                <label>
                  Dirección
                  <input
                    name="address"
                    defaultValue={editing?.address ?? ""}
                    required
                    minLength={3}
                    maxLength={300}
                  />
                </label>
                <label className="sm:col-span-2">
                  Observaciones
                  <textarea
                    name="notes"
                    defaultValue={editing?.notes ?? ""}
                    maxLength={2000}
                    rows={3}
                  />
                </label>
              </fieldset>
              {message && message !== "Cliente guardado." && (
                <Notice error>{message}</Notice>
              )}
              <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-5">
                <Button disabled={busy} type="submit">
                  {busy ? "Guardando…" : "Guardar cliente"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowForm(false)}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          </Sheet>
        </>
      )}
    </AppShell>
  );
}
