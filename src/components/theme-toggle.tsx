"use client";
import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "./ui/button";
const themeKey = "pm-creditos-theme";
type Preference = "light" | "dark" | "system";
function apply(preference: Preference) {
  if (preference === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = preference;
}
function setTheme(preference: Preference) {
  apply(preference);
  try {
    if (preference === "system") localStorage.removeItem(themeKey);
    else localStorage.setItem(themeKey, preference);
  } catch {
    /* The choice still works if storage is unavailable. */
  }
  window.dispatchEvent(new Event("pm-theme-change"));
}
function subscribe(notify: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const storage = (event: StorageEvent) => {
    if (event.key !== themeKey && event.key !== null) return;
    apply(
      event.newValue === "light" || event.newValue === "dark"
        ? event.newValue
        : "system",
    );
    notify();
  };
  window.addEventListener("pm-theme-change", notify);
  window.addEventListener("storage", storage);
  media.addEventListener("change", notify);
  return () => {
    window.removeEventListener("pm-theme-change", notify);
    window.removeEventListener("storage", storage);
    media.removeEventListener("change", notify);
  };
}
function snapshot() {
  const preference = document.documentElement.dataset.theme;
  const mode =
    preference === "dark" || preference === "light"
      ? preference
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  return `${preference ?? "system"}:${mode}`;
}
function useTheme() {
  const value = useSyncExternalStore(subscribe, snapshot, () => "system:light");
  const [preference, mode] = value.split(":");
  return { preference, mode };
}
export function ThemeToggle() {
  const { mode } = useTheme();
  const label = mode === "dark" ? "Activar modo día" : "Activar modo noche";
  return (
    <Button
      variant="outline"
      aria-label={label}
      title={label}
      onClick={() => setTheme(mode === "dark" ? "light" : "dark")}
      className="px-3"
    >
      {mode === "dark" ? (
        <Sun size={19} aria-hidden="true" />
      ) : (
        <Moon size={19} aria-hidden="true" />
      )}
      <span className="hidden sm:inline">
        {mode === "dark" ? "Modo día" : "Modo noche"}
      </span>
    </Button>
  );
}
export function ThemePreference() {
  const { preference, mode } = useTheme();
  return (
    <div className="space-y-3 border-b border-slate-100 pb-4">
      <div className="flex flex-wrap justify-between gap-3 text-sm">
        <span className="text-slate-500">Apariencia</span>
        <span className="font-medium">
          {preference === "system"
            ? "Automática · según el dispositivo"
            : mode === "dark"
              ? "Modo noche"
              : "Modo día"}
        </span>
      </div>
      <Button
        variant="outline"
        disabled={preference === "system"}
        onClick={() => setTheme("system")}
      >
        Usar configuración del dispositivo
      </Button>
    </div>
  );
}
