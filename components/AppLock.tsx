"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { KeyRound, ScanFace, Wallet } from "lucide-react";
import { getLock, unlockWithBiometrics } from "@/lib/applock";
import { supabaseBrowser } from "@/lib/supabase/client";

const FRESH = "fp:fresh-login";
// Si la app abre la cámara o el selector de archivos, iOS la manda a segundo plano: eso no debe bloquear.
const PICKER_GRACE_MS = 3 * 60 * 1000;

const root = () => document.documentElement;

/**
 * Candado "siempre al volver": cada vez que la app pasa a segundo plano se tapa el contenido
 * (también en el selector de apps de iOS) y al volver pide Face ID.
 */
export function AppLock() {
  const router = useRouter();
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pickerUntil = useRef(0);
  const tried = useRef(false);

  const lockNow = useCallback(() => {
    if (!getLock()) return;
    root().setAttribute("data-locked", "1");
    tried.current = false;
    setError(null);
    setLocked(true);
  }, []);

  const unlock = useCallback(async () => {
    const cfg = getLock();
    if (!cfg) {
      root().removeAttribute("data-locked");
      setLocked(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (await unlockWithBiometrics(cfg)) {
        root().removeAttribute("data-locked");
        setLocked(false);
      } else setError("No se pudo verificar. Probá de nuevo.");
    } catch (e) {
      const name = (e as Error)?.name;
      setError(
        name === "NotAllowedError" ? "Cancelado. Tocá el botón para intentar de nuevo."
          : name === "InvalidStateError" || name === "NotFoundError" ? "Este dispositivo ya no tiene la credencial. Ingresá con tu contraseña."
          : "No se pudo usar Face ID en este dispositivo.",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  // Arranque en frío
  useEffect(() => {
    let fresh = false;
    try {
      fresh = sessionStorage.getItem(FRESH) === "1";
      sessionStorage.removeItem(FRESH);
    } catch {}
    if (getLock() && !fresh) lockNow();
    else root().removeAttribute("data-locked");
  }, [lockNow]);

  // Segundo plano / regreso
  useEffect(() => {
    const onClick = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input[type="file"]') || (t?.closest?.("label") as HTMLLabelElement | null)?.control?.matches?.('input[type="file"]'))
        pickerUntil.current = Date.now() + PICKER_GRACE_MS;
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        if (Date.now() < pickerUntil.current) return;
        lockNow();
      } else if (document.visibilityState === "visible") {
        pickerUntil.current = 0;
      }
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onVis);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onVis);
    };
  }, [lockNow]);

  // Al quedar bloqueada y visible: intenta Face ID una vez sola; si iOS exige un toque, queda el botón.
  useEffect(() => {
    if (!locked || tried.current || document.visibilityState !== "visible") return;
    tried.current = true;
    const t = setTimeout(unlock, 250);
    return () => clearTimeout(t);
  }, [locked, unlock]);
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && locked && !tried.current) {
        tried.current = true;
        setTimeout(unlock, 250);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [locked, unlock]);

  async function usePassword() {
    await supabaseBrowser().auth.signOut();
    root().removeAttribute("data-locked");
    router.replace("/login");
    router.refresh();
  }

  if (!locked) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="App bloqueada"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-slate-50 px-6 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-center dark:bg-slate-950">
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-xl shadow-brand-600/30">
        <Wallet size={28} />
      </span>
      <h1 className="mt-5 text-xl font-bold text-slate-900 dark:text-white">Mis Finanzas está bloqueada</h1>
      <p className="mt-1 text-sm text-slate-500">Desbloqueá con Face ID para ver tus números.</p>
      <button onClick={unlock} disabled={busy}
        className="mt-8 flex h-12 w-full max-w-xs items-center justify-center gap-2 rounded-xl bg-brand-600 font-medium text-white shadow-lg shadow-brand-600/25 disabled:opacity-60">
        <ScanFace size={20} /> {busy ? "Verificando…" : "Desbloquear"}
      </button>
      {error && <p className="mt-3 max-w-xs text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button onClick={usePassword} className="mt-6 flex items-center gap-1.5 text-sm font-medium text-slate-500 underline-offset-4 hover:underline">
        <KeyRound size={15} /> Usar contraseña
      </button>
    </div>
  );
}

/** Lo llama el login después de una contraseña correcta: no volver a pedir Face ID enseguida. */
export function markFreshLogin() {
  try {
    sessionStorage.setItem(FRESH, "1");
  } catch {}
}
