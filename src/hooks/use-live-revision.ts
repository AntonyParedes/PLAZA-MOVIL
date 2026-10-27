"use client";
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

// Re-read authorized data after a notification; never trust a socket payload as the balance.
export function useLiveRevision(enabled = true, includeCash = false) {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const supabase = getSupabase();
    if (!enabled || !supabase) return;
    let pending: ReturnType<typeof setTimeout> | undefined;
    let active = true;
    const refresh = () => {
      if (document.visibilityState !== "visible" || pending) return;
      pending = setTimeout(() => {
        pending = undefined;
        if (active) setRevision(value => value + 1);
      }, 200);
    };
    const channel = supabase.channel(`pm-live-${crypto.randomUUID()}`);
    for (const table of ["clients", "profiles", "loans", "loan_periods", "payments", "installments", "payment_installments", ...(includeCash ? ["cash_movements"] : [])]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, refresh);
    }
    channel.subscribe(status => {
      if (status === "SUBSCRIBED") refresh();
    });
    // Catch missed changes while offline or when Realtime is not enabled on the project.
    const timer = setInterval(refresh, 30000);
    let wasHidden = document.visibilityState === "hidden";
    const onVisibility = () => {
      if (document.visibilityState === "hidden") { wasHidden = true; return; }
      if (wasHidden) { wasHidden = false; refresh(); }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      clearInterval(timer);
      if (pending) clearTimeout(pending);
      document.removeEventListener("visibilitychange", onVisibility);
      void supabase.removeChannel(channel);
    };
  }, [enabled, includeCash]);
  return revision;
}
