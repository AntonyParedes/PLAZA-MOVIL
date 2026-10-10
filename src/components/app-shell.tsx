"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Dialog, DropdownMenu } from "radix-ui";
import {
  Landmark,
  LayoutDashboard,
  Users,
  Wallet,
  RefreshCw,
  ChartNoAxesCombined,
  Settings,
  TableProperties,
  FileSpreadsheet,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
  ChevronDown,
  LogOut,
  ShieldCheck,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/dashboard";
import { cn } from "@/lib/utils";
export type Section =
  | "dashboard"
  | "clientes"
  | "general"
  | "prestamos"
  | "refinanciaciones"
  | "reportes"
  | "configuracion"
  | "importar";
const navigation = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "general", label: "Panel general", icon: TableProperties },
  { id: "clientes", label: "Clientes", icon: Users },
  { id: "prestamos", label: "Préstamos", icon: Wallet },
  { id: "refinanciaciones", label: "Refinanciaciones", icon: RefreshCw },
  { id: "reportes", label: "Reportes", icon: ChartNoAxesCombined },
  { id: "configuracion", label: "Configuración", icon: Settings },
  { id: "importar", label: "Revisar Excel", icon: FileSpreadsheet },
] as const;
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-[#102b18]">
        <Landmark size={22} aria-hidden="true" />
      </span>
      {!compact && (
        <div>
          <p className="text-lg font-semibold tracking-tight">PM Créditos</p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Gestión financiera
          </p>
        </div>
      )}
    </div>
  );
}
export default function AppShell({
  section,
  onNavigate,
  role,
  onLogout,
  search,
  onSearchChange,
  children,
}: {
  section: Section;
  onNavigate: (section: Section) => void;
  role: "administrador" | "jefe";
  onLogout: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [section]);
  const title =
    navigation.find((item) => item.id === section)?.label ?? "Dashboard";
  function menu(compact: boolean) {
    return (
      <>
        <div className={cn("px-5 pb-7 pt-8", compact && "px-4")}>
          <Brand compact={compact} />
        </div>
        <nav
          aria-label="Menú principal"
          className="flex flex-1 flex-col gap-1 px-3"
        >
          {navigation
            .filter(
              (item) => item.id !== "importar" || role === "administrador",
            )
            .map((item) => (
              <button
                key={item.id}
                title={compact ? item.label : undefined}
                aria-current={section === item.id ? "page" : undefined}
                onClick={() => {
                  onNavigate(item.id);
                  setMobileOpen(false);
                }}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-xl px-3 py-3 text-left text-[13px] font-medium transition-colors",
                  section === item.id
                    ? "bg-blue-600/20 text-blue-200 ring-1 ring-blue-400/20"
                    : "text-slate-300 hover:bg-white/5 hover:text-white",
                  compact && "justify-center px-2",
                )}
              >
                <item.icon size={19} aria-hidden="true" className="shrink-0" />
                <span className={compact ? "sr-only" : ""}>{item.label}</span>
              </button>
            ))}
        </nav>
        <div
          className={cn(
            "mx-4 mb-5 mt-6 rounded-xl border border-white/10 p-3.5",
            compact && "mx-3 p-2",
          )}
        >
          <ShieldCheck size={18} className="text-blue-300" aria-hidden="true" />
          {!compact && (
            <>
              <p className="mt-2 text-xs font-medium text-slate-200">
                Acceso autorizado
              </p>
              <p className="mt-1 text-[11px] text-slate-400">
                Soles · PEN / Lima
              </p>
            </>
          )}
        </div>
      </>
    );
  }
  return (
    <div className="min-h-screen">
      <a href="#contenido" className="skip-link">
        Ir al contenido
      </a>
      <aside
        className={cn(
          "app-navigation fixed inset-y-0 left-0 z-30 hidden flex-col overflow-y-auto bg-[var(--navy)] text-white transition-[width] lg:flex",
          collapsed ? "w-20" : "w-64",
        )}
      >
        <div className="flex min-h-full flex-col">
          {menu(collapsed)}
          <button
            className="mx-3 mb-4 flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 text-xs text-slate-300 hover:bg-white/5"
            aria-label={collapsed ? "Expandir menú" : "Contraer menú"}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? (
              <PanelLeftOpen size={18} />
            ) : (
              <>
                <PanelLeftClose size={18} /> Contraer menú
              </>
            )}
          </button>
        </div>
      </aside>
      <div
        className={cn(
          "min-w-0 transition-[padding] lg:pl-64",
          collapsed && "lg:pl-20",
        )}
      >
        <header className="sticky top-0 z-20 flex min-h-20 items-center justify-between gap-3 border-b border-slate-200/70 bg-white/95 px-4 backdrop-blur sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
              <Dialog.Trigger asChild>
                <Button
                  variant="outline"
                  aria-label="Abrir menú"
                  className="px-3 lg:hidden"
                >
                  <Menu size={20} />
                </Button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/45 lg:hidden" />
                <Dialog.Content className="app-navigation fixed inset-y-0 left-0 z-50 flex w-[min(296px,85vw)] flex-col overflow-y-auto bg-[var(--navy)] text-white lg:hidden">
                  <Dialog.Title className="sr-only">Navegación</Dialog.Title>
                  <Dialog.Description className="sr-only">
                    Selecciona un módulo de PM Créditos.
                  </Dialog.Description>
                  <Dialog.Close asChild>
                    <button
                      aria-label="Cerrar menú"
                      className="absolute right-3 top-3 rounded-lg p-3 text-slate-300"
                    >
                      <X size={18} />
                    </button>
                  </Dialog.Close>
                  {menu(false)}
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
            <div className="min-w-0">
              <p className="hidden text-[11px] font-medium uppercase tracking-wider text-slate-500 sm:block">
                Plaza Móvil / Gestión de créditos
              </p>
              <h1 className="text-lg font-semibold tracking-tight text-slate-900">
                {title}
              </h1>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            {!["configuracion", "importar"].includes(section) && (
              <div className="relative hidden w-56 lg:block">
                <Search
                  size={16}
                  aria-hidden="true"
                  className="absolute left-3 top-3.5 text-slate-400"
                />
                <input
                  aria-label="Búsqueda de clientes en la barra superior"
                  value={search}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="Buscar cliente, DNI o stand"
                  className="!mt-0 pl-9"
                />
              </div>
            )}
            <span className="hidden text-xs text-slate-500 xl:block">
              {new Intl.DateTimeFormat("es-PE", {
                timeZone: "America/Lima",
                day: "numeric",
                month: "long",
                year: "numeric",
              }).format(new Date())}
            </span>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  aria-label="Menú de usuario"
                  className="flex min-h-11 items-center gap-2 rounded-xl p-1.5 hover:bg-slate-50"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full border border-blue-100 bg-blue-50 text-xs font-bold text-blue-700">
                    {role === "administrador" ? "AD" : "JF"}
                  </span>
                  <span className="hidden text-left sm:block">
                    <span className="block text-xs font-semibold text-slate-800">
                      Mi cuenta
                    </span>
                    <span className="block text-[11px] capitalize text-slate-500">
                      {role}
                    </span>
                  </span>
                  <ChevronDown size={14} className="text-slate-400" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={10}
                  className="z-50 min-w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-lg"
                >
                  <div className="px-3 py-2 text-xs text-slate-500">
                    Sesión autorizada <Badge tone="info">{role}</Badge>
                  </div>
                  <DropdownMenu.Item
                    onSelect={() => onNavigate("configuracion")}
                    className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm outline-none focus:bg-slate-50"
                  >
                    <Settings size={16} /> Configuración
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator className="my-1 h-px bg-slate-100" />
                  <DropdownMenu.Item
                    onSelect={onLogout}
                    className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm text-red-700 outline-none focus:bg-red-50"
                  >
                    <LogOut size={16} /> Cerrar sesión
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </header>
        <main
          id="contenido"
          tabIndex={-1}
          className="mx-auto max-w-[1680px] space-y-6 p-4 sm:p-6 lg:p-8"
        >
          {children}
        </main>
        <footer className="px-6 pb-6 text-xs text-slate-500">
          PM Créditos · Montos en soles · Hora de Lima
        </footer>
      </div>
    </div>
  );
}
