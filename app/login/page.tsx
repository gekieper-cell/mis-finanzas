"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Eye, EyeOff, Lock, Mail, ShieldCheck, Wallet } from "lucide-react";
import { markFreshLogin } from "@/components/AppLock";
import { supabaseBrowser } from "@/lib/supabase/client";

/** ¿La sesión actual necesita el código del autenticador? (consulta fresca a Supabase) */
async function needsCode(): Promise<boolean | null> {
  const sb = supabaseBrowser();
  const { data } = await sb.auth.getSession();
  if (!data.session) return null;
  const { data: aal, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel(data.session.access_token);
  if (error || !aal) return null;
  return aal.nextLevel === "aal2" && aal.currentLevel !== "aal2";
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"password" | "code">("password");
  const [code, setCode] = useState("");

  const enter = () => {
    markFreshLogin();
    router.replace("/");
    router.refresh();
  };

  // Si ya hay sesión (p. ej. falta el segundo paso), retomar desde ahí
  useEffect(() => {
    needsCode().then((n) => {
      if (n === true) setStep("code");
      else if (n === false) router.replace("/");
    });
  }, [router]);

  async function onCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const sb = supabaseBrowser();
    const { data: f, error: fe } = await sb.auth.mfa.listFactors();
    const factor = f?.totp[0];
    if (fe || !factor) {
      setLoading(false);
      setError("No se encontró el autenticador de la cuenta.");
      return;
    }
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() });
    setLoading(false);
    if (error) {
      setCode("");
      const c = (error as { code?: string }).code;
      setError(c === "mfa_verification_failed" ? "Código incorrecto o vencido." : c === "over_request_rate_limit" ? "Demasiados intentos. Esperá unos minutos." : `No se pudo verificar: ${error.message}`);
      return;
    }
    enter();
  }

  async function cancelCode() {
    await supabaseBrowser().auth.signOut();
    setStep("password");
    setCode("");
    setError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) {
      // Credenciales: mensaje genérico (no revela si el email existe).
      // Otros errores (config, red, email sin confirmar): se muestran para poder diagnosticar.
      const code = (error as { code?: string }).code;
      if (code === "invalid_credentials" || error.status === 400 && /invalid login/i.test(error.message)) {
        setError("Email o contraseña incorrectos.");
      } else if (code === "email_not_confirmed") {
        setError("El usuario no está confirmado. En Supabase, recrealo tildando 'Auto Confirm User'.");
      } else {
        setError(`No se pudo ingresar: ${error.message}${error.status ? ` (HTTP ${error.status})` : ""}`);
      }
      return;
    }
    if (await needsCode()) {
      setStep("code");
      return;
    }
    enter();
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-slate-50 px-4 py-[env(safe-area-inset-top)] dark:bg-slate-950">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-brand-500/20 blur-3xl" />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-xl shadow-brand-600/30">
            <Wallet size={26} />
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Mis Finanzas</h1>
          <p className="mt-1 text-sm text-slate-500">Ingresá para ver tus números</p>
        </div>

        {step === "code" ? (
          <form onSubmit={onCode} className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start gap-3">
              <ShieldCheck size={22} className="mt-0.5 shrink-0 text-brand-600" />
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">Verificación en dos pasos</p>
                <p className="text-sm text-slate-500">Ingresá el código de 6 dígitos de tu app autenticadora.</p>
              </div>
            </div>
            <input
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" required autoFocus aria-label="Código"
              placeholder="000000"
              className="h-14 w-full rounded-xl border border-slate-200 bg-white text-center text-2xl font-semibold tracking-[0.4em] outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-slate-700 dark:bg-slate-800"
            />
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">{error}</p>}
            <button type="submit" disabled={loading || code.length !== 6}
              className="h-11 w-full rounded-xl bg-brand-600 font-medium text-white shadow-lg shadow-brand-600/25 transition hover:bg-brand-700 disabled:opacity-60">
              {loading ? "Verificando…" : "Verificar"}
            </button>
            <button type="button" onClick={cancelCode} className="w-full text-center text-sm text-slate-500 hover:underline">Cancelar y volver</button>
          </form>
        ) : (
        <form onSubmit={onSubmit} className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/5 dark:border-slate-800 dark:bg-slate-900">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Email</span>
            <div className="relative">
              <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
                className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-base outline-none sm:h-11 sm:text-sm focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Contraseña</span>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type={show ? "text" : "password"} required autoComplete="current-password" value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-10 text-base outline-none sm:h-11 sm:text-sm focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-slate-700 dark:bg-slate-800"
              />
              <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400" aria-label="Mostrar contraseña">
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">{error}</p>}
          <button
            type="submit" disabled={loading}
            className="h-11 w-full rounded-xl bg-brand-600 font-medium text-white shadow-lg shadow-brand-600/25 transition hover:bg-brand-700 disabled:opacity-60"
          >
            {loading ? "Ingresando…" : "Ingresar"}
          </button>
        </form>
        )}
        <p className="mt-6 text-center text-xs text-slate-400">Acceso privado · registro deshabilitado</p>
      </div>
    </div>
  );
}
