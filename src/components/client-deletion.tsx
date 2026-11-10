"use client";

import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { getSupabase } from "@/lib/supabase";
import { formatPEN } from "@/lib/finance";
import { Button } from "./ui/button";
import { Notice, Sheet } from "./ui/dashboard";

const snapshotSchema = z.object({
  client_id: z.string(),
  full_name: z.string(),
  dni: z.string().regex(/^\d{8}$/),
  stand_code: z.string().nullable(),
  loans_count: z.number().int().nonnegative(),
  payments_count: z.number().int().nonnegative(),
  balance_cents: z.string().regex(/^\d+$/),
  paid_cents: z.string().regex(/^\d+$/),
  confirmation_token: z.string().regex(/^[a-f0-9]{32}$/),
});
type Snapshot = z.infer<typeof snapshotSchema>;
const supabase = getSupabase();
function errorMessage(error: { message: string; code?: string }) {
  if (error.code === "PGRST202" || /schema cache|Could not find.*function/i.test(error.message))
    return "Falta habilitar la eliminación en Supabase. Ejecuta la migración 202610190008_delete_client.sql en SQL Editor y vuelve a intentar.";
  return error.message;
}

export default function ClientDeletion({ client, onClose, onDeleted }: {
  client: { id: string; full_name: string };
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [summary, setSummary] = useState<Snapshot | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dni, setDni] = useState("");
  const [reason, setReason] = useState("");
  const [stale, setStale] = useState(false);
  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setSummary(null);
      setError("");
      setDni("");
      try {
        const result = await supabase!.rpc("preview_client_deletion", { p_client: client.id });
        if (result.error) throw Error(errorMessage(result.error));
        const validated = snapshotSchema.safeParse(result.data);
        if (!validated.success) throw Error("No se pudo verificar el resumen del cliente. Actualiza para volver a intentar.");
        const parsed = validated.data;
        if (parsed.client_id !== client.id) throw Error("El resumen no corresponde al cliente seleccionado.");
        if (active) { setSummary(parsed); setStale(false); }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "No se pudo cargar el resumen. Intenta nuevamente.");
      } finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [client.id, revision]);
  const canDelete = summary && !loading && !busy && !stale && dni.trim() === summary.dni && reason.trim().length >= 3 && reason.trim().length <= 300;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canDelete || !summary) return;
    setBusy(true);
    setError("");
    try {
      const result = await supabase!.rpc("delete_client", {
        p_client: client.id, p_dni: dni.trim(), p_reason: reason.trim(), p_confirmation_token: summary.confirmation_token,
      });
      if (result.error) throw Error(errorMessage(result.error));
      if (result.data !== client.id) throw Error("No se pudo confirmar la eliminación. Vuelve a intentar.");
      onDeleted(client.id);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "No se pudo eliminar. Revisa tu conexión y vuelve a intentar.";
      setError(message);
      if (message.includes("Los datos cambiaron")) setStale(true);
    } finally { setBusy(false); }
  }
  return <Sheet open onOpenChange={(open) => { if (!open && !busy) onClose(); }} title="Eliminar cliente" description="Revisa los registros antes de confirmar la eliminación definitiva.">
    <div className="space-y-5">
      <Notice error>Esta acción es irreversible. Se eliminarán el cliente, su deuda, préstamos, refinanciaciones, cuotas y pagos asociados. Estos importes dejarán de aparecer en los reportes. Se conservará una constancia de auditoría. No elimina ninguna cuenta de acceso al sistema.</Notice>
      <h3 className="break-words text-lg font-semibold">{summary?.full_name ?? client.full_name}</h3>
      {loading && <p role="status">Cargando resumen para confirmar…</p>}
      {error && <Notice error>{error}</Notice>}
      {summary && <dl className="grid grid-cols-2 gap-4 rounded-xl bg-slate-50 p-4 text-sm">
        <div><dt>DNI</dt><dd className="font-semibold">{summary.dni}</dd></div>
        <div><dt>Stand</dt><dd>{summary.stand_code ?? "Sin registrar"}</dd></div>
        <div><dt>Préstamos</dt><dd>{summary.loans_count}</dd></div>
        <div><dt>Pagos registrados</dt><dd>{summary.payments_count}</dd></div>
        <div><dt>Saldo a eliminar</dt><dd className="font-semibold">{formatPEN(BigInt(summary.balance_cents))}</dd></div>
        <div><dt>Total cobrado a eliminar</dt><dd className="font-semibold">{formatPEN(BigInt(summary.paid_cents))}</dd></div>
      </dl>}
      {!loading && (error || stale) && <Button variant="outline" disabled={busy} onClick={() => setRevision((n) => n + 1)}>Actualizar resumen</Button>}
      <form onSubmit={submit} className="space-y-5">
        <label className="block">Escribe el DNI del cliente para confirmar
          <input className="mt-2" value={dni} onChange={(e) => setDni(e.target.value)} inputMode="numeric" maxLength={8} autoComplete="off" required disabled={busy || loading || !summary || stale} />
        </label>
        <label className="block">Motivo de la eliminación
          <textarea className="mt-2" value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={300} rows={3} required disabled={busy} placeholder="Ejemplo: cliente registrado por error" />
        </label>
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={!canDelete} className="border border-[var(--danger-text)] bg-[var(--danger-bg)] text-[var(--danger-text)] hover:brightness-95">{busy ? "Eliminando…" : "Eliminar definitivamente"}</Button>
        </div>
      </form>
    </div>
  </Sheet>;
}
