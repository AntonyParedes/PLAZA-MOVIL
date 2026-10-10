"use client";
import { useRef, type ReactNode, type ComponentType } from "react";
import { Dialog } from "radix-ui";
import { Inbox, X, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}) {
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        {
          neutral: "bg-slate-100 text-slate-700",
          success: "bg-emerald-50 text-emerald-800",
          warning: "bg-amber-50 text-amber-800",
          danger: "bg-red-50 text-red-700",
          info: "bg-blue-50 text-blue-700",
        }[tone],
      )}
    >
      {children}
    </span>
  );
}
export function PaymentBadge({ status }: { status: string }) {
  const text =
    (
      {
        pagado: "Pagado",
        pendiente: "Pendiente",
        vencido: "Vencido",
        "pago parcial": "Pago parcial",
        activo: "Activo",
        liquidado: "Liquidado",
      } as Record<string, string>
    )[status] ?? status;
  const tone = ["pagado", "liquidado", "Puntual"].includes(status)
    ? "success"
    : ["vencido", "En mora", "Liquidación urgente"].includes(status)
      ? "danger"
      : ["pendiente", "pago parcial", "Atrasado"].includes(status)
        ? "warning"
        : "info";
  return <Badge tone={tone}>{text}</Badge>;
}
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("surface p-5 sm:p-6", className)}>
      {children}
    </section>
  );
}
export function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-5 py-12 text-center">
      <div className="mb-4 rounded-2xl bg-slate-50 p-3 text-slate-400">
        <Inbox size={26} aria-hidden="true" />
      </div>
      <h3 className="font-semibold text-slate-800">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
        {description}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
export function LoadingSkeleton({
  label = "Cargando operaciones…",
}: {
  label?: string;
}) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div
        aria-hidden="true"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="surface animate-pulse p-6">
            <div className="h-3 w-24 rounded bg-slate-100" />
            <div className="mt-5 h-8 w-36 rounded bg-slate-100" />
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="surface mt-6 space-y-5 p-6">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-10 animate-pulse rounded bg-slate-100" />
        ))}
      </div>
    </div>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      role={error ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-xl border p-4 text-sm leading-6",
        error
          ? "border-red-200 bg-red-50 text-red-800"
          : "border-emerald-200 bg-emerald-50 text-emerald-800",
      )}
    >
      {error ? (
        <AlertCircle className="mt-0.5 shrink-0" size={18} />
      ) : (
        <CheckCircle2 className="mt-0.5 shrink-0" size={18} />
      )}
      <div>{children}</div>
    </div>
  );
}
export function Kpi({
  label,
  value,
  note,
  icon: Icon,
  tone = "blue",
}: {
  label: string;
  value: ReactNode;
  note: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  tone?: "blue" | "green" | "red" | "amber" | "purple";
}) {
  return (
    <article className="surface p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <span
          className={cn(
            "rounded-xl p-2.5",
            {
              blue: "bg-blue-50 text-blue-600",
              purple: "bg-[var(--accent-soft)] text-[var(--accent-text)]",
              green: "bg-emerald-50 text-emerald-700",
              red: "bg-red-50 text-red-600",
              amber: "bg-amber-50 text-amber-700",
            }[tone],
          )}
        >
          <Icon size={18} />
        </span>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
        {value}
      </p>
      <p className="mt-2 text-xs text-slate-500">{note}</p>
    </article>
  );
}
export function DataTable({
  headers,
  rows,
  keys,
  caption,
  rowClassNames,
  emptyTitle = "Sin resultados",
  emptyDescription = "Prueba otra búsqueda o cambia los filtros.",
}: {
  headers: string[];
  rows: ReactNode[][];
  keys: string[];
  caption: string;
  rowClassNames?: string[];
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  if (!rows.length)
    return (
      <div className="surface">
        <EmptyState title={emptyTitle} description={emptyDescription} />
      </div>
    );
  return (
    <div className="data-table surface">
      <div className="table-scroll">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {headers.map((h) => (
                <th scope="col" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((cells, index) => (
              <tr key={keys[index]} className={rowClassNames?.[index]}>
                {cells.map((cell, i) => (
                  <td key={headers[i]} data-label={headers[i]}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const previousFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/45" />
        <Dialog.Content
          onOpenAutoFocus={() => {
            previousFocus.current = document.activeElement as HTMLElement;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            previousFocus.current?.focus();
          }}
          className="detail-sheet fixed inset-y-0 right-0 z-50 flex w-full max-w-3xl flex-col bg-white shadow-2xl"
        >
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-7">
            <div className="min-w-0">
              <Dialog.Title className="text-xl font-semibold tracking-tight text-slate-900">
                {title}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-slate-500">
                {description}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button
                variant="outline"
                className="px-3"
                aria-label="Cerrar detalle"
              >
                <X size={20} />
              </Button>
            </Dialog.Close>
          </div>
          <div className="min-h-0 overflow-y-auto overscroll-contain p-5 sm:p-7">
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
