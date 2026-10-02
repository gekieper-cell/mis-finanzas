"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, ScanFace, ShieldCheck, ShieldOff, Smartphone } from "lucide-react";
import { clearLock, enrollLock, getLock, lockAvailable, type LockConfig } from "@/lib/applock";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PushSettings } from "@/components/PushSettings";
import { Button, Card, CardHeader, Input, PageHeader, cx } from "@/components/ui";

export default function Ajustes() {
  return (
    <>
      <PageHeader title="Ajustes" subtitle="Seguridad y avisos" />
      <div className="grid gap-5 lg:grid-cols-2">
        <FaceIdCard />
        <TotpCard />
        <PushSettings />
      </div>
    </>
  );
}

function Status({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
      on ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}>
      {children}
    </span>
  );
}

/* ---------------- Face ID (este dispositivo) ---------------- */
function FaceIdCard() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [cfg, setCfg] = useState<LockConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setCfg(getLock());
    lockAvailable().then(setAvailable);
  }, []);

  async function enable() {
    setBusy(true);
    setMsg(null);
    try {
      const { data } = await supabaseBrowser().auth.getSession();
      const c = await enrollLock(data.session?.user.email ?? "");
      setCfg(c);
      setMsg({ ok: true, text: "Listo. Cada vez que vuelvas a la app te va a pedir Face ID." });
    } catch (e) {
      clearLock();
      setCfg(null);
      const name = (e as Error)?.name;
      setMsg({ ok: false, text: name === "NotAllowedError" ? "Cancelado." : "No se pudo activar en este dispositivo." });
    } finally {
      setBusy(false);
    }
  }

  function disable() {
    clearLock();
    setCfg(null);
    setMsg({ ok: true, text: "Bloqueo desactivado en este dispositivo." });
  }

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><ScanFace size={18} /> Bloqueo con Face ID</span>}
        subtitle="Solo en este dispositivo. Tapa la app cada vez que sale de primer plano."
        action={<Status on={!!cfg}>{cfg ? <><Check size={13} /> Activo</> : "Inactivo"}</Status>}
      />
      <div className="space-y-3 p-5">
        {available === false && !cfg && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            Este navegador no ofrece Face ID / Touch ID. En iPhone usalo desde la app instalada (Compartir → Agregar a inicio).
          </p>
        )}
        <p className="text-sm text-slate-500">
          Es un candado de privacidad: si alguien agarra el celular desbloqueado no ve tus números. Tu cara no sale del
          teléfono; la app solo recibe un “verificado”. No reemplaza la contraseña ni el doble factor.
        </p>
        {cfg ? (
          <Button variant="secondary" onClick={disable}>Desactivar</Button>
        ) : (
          <Button onClick={enable} disabled={busy || available === false}>{busy ? "Esperando Face ID…" : "Activar Face ID"}</Button>
        )}
        {msg && <p className={cx("text-sm", msg.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-600")}>{msg.text}</p>}
      </div>
    </Card>
  );
}

/* ---------------- Verificación en dos pasos (TOTP) ---------------- */
type Enroll = { id: string; qr: string; secret: string; uri: string };

function TotpCard() {
  const [loading, setLoading] = useState(true);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [aal, setAal] = useState<string | null>(null);
  const [enroll, setEnroll] = useState<Enroll | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const [{ data: f }, { data: a }] = await Promise.all([sb.auth.mfa.listFactors(), sb.auth.mfa.getAuthenticatorAssuranceLevel()]);
    setFactorId(f?.totp[0]?.id ?? null);
    setAal(a?.currentLevel ?? null);
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function start() {
    setBusy(true);
    setMsg(null);
    const sb = supabaseBrowser();
    // Restos de intentos anteriores sin terminar
    const { data: f } = await sb.auth.mfa.listFactors();
    for (const x of f?.all ?? []) if (x.status !== "verified") await sb.auth.mfa.unenroll({ factorId: x.id });
    const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "Mis Finanzas", issuer: "Mis Finanzas" });
    setBusy(false);
    if (error || !data) {
      setMsg({ ok: false, text: `No se pudo iniciar: ${error?.message ?? "error"}. ¿Está habilitado TOTP en Supabase (Authentication → Multi-Factor)?` });
      return;
    }
    setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri });
    setCode("");
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!enroll) return;
    setBusy(true);
    setMsg(null);
    const { error } = await supabaseBrowser().auth.mfa.challengeAndVerify({ factorId: enroll.id, code: code.trim() });
    setBusy(false);
    if (error) {
      setCode("");
      setMsg({ ok: false, text: "Código incorrecto o vencido. Probá con el que aparece ahora." });
      return;
    }
    setEnroll(null);
    setMsg({ ok: true, text: "Doble factor activado. Desde ahora, además de la contraseña, te va a pedir el código." });
    load();
  }

  async function cancel() {
    if (enroll) await supabaseBrowser().auth.mfa.unenroll({ factorId: enroll.id });
    setEnroll(null);
  }

  async function disable() {
    if (!factorId) return;
    setBusy(true);
    const { error } = await supabaseBrowser().auth.mfa.unenroll({ factorId });
    setBusy(false);
    setConfirmOff(false);
    if (error) {
      setMsg({ ok: false, text: aal !== "aal2" ? "Para desactivarlo tenés que haber ingresado con el código. Cerrá sesión y volvé a entrar." : `No se pudo: ${error.message}` });
      return;
    }
    setMsg({ ok: true, text: "Doble factor desactivado." });
    load();
  }

  async function copy() {
    if (!enroll) return;
    try {
      await navigator.clipboard.writeText(enroll.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><ShieldCheck size={18} /> Verificación en dos pasos</span>}
        subtitle="Código de 6 dígitos de una app autenticadora al iniciar sesión."
        action={!loading && <Status on={!!factorId}>{factorId ? <><Check size={13} /> Activa</> : "Inactiva"}</Status>}
      />
      <div className="space-y-3 p-5">
        {loading ? null : enroll ? (
          <form onSubmit={confirm} className="space-y-4">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
              <li>Agregá la cuenta en tu app autenticadora (Contraseñas de iPhone, Google Authenticator, 1Password…).</li>
              <li>Escribí abajo el código de 6 dígitos que te muestra.</li>
            </ol>
            <div className="flex flex-wrap items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={enroll.qr} alt="Código QR para la app autenticadora" className="h-40 w-40 rounded-xl bg-white p-2 ring-1 ring-slate-200" />
              <div className="min-w-0 flex-1 space-y-2 text-sm">
                <a href={enroll.uri} className="inline-flex items-center gap-1.5 font-medium text-brand-600 hover:underline">
                  <Smartphone size={15} /> Agregar en este celular <ExternalLink size={13} />
                </a>
                <button type="button" onClick={() => setShowSecret(!showSecret)} className="block text-slate-500 hover:underline">
                  {showSecret ? "Ocultar clave" : "No puedo escanear: mostrar clave"}
                </button>
                {showSecret && (
                  <div className="flex items-center gap-2">
                    <code className="break-all rounded-lg bg-slate-100 px-2 py-1 font-mono text-xs dark:bg-slate-800">{enroll.secret.match(/.{1,4}/g)?.join(" ")}</code>
                    <button type="button" onClick={copy} className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Copiar clave">
                      {copied ? <Check size={15} /> : <Copy size={15} />}
                    </button>
                  </div>
                )}
              </div>
            </div>
            <Input
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric" autoComplete="one-time-code" placeholder="Código de 6 dígitos" aria-label="Código de verificación"
              className="text-center font-semibold tracking-[0.3em]"
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={busy || code.length !== 6}>{busy ? "Verificando…" : "Confirmar y activar"}</Button>
              <Button type="button" variant="ghost" onClick={cancel}>Cancelar</Button>
            </div>
          </form>
        ) : factorId ? (
          <>
            <p className="text-sm text-slate-500">
              Aunque alguien consiga tu contraseña, sin el código no puede ver ni tocar tus datos: lo exige la propia base de datos.
            </p>
            {confirmOff ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm">¿Seguro? Tu cuenta queda protegida solo con la contraseña.</span>
                <Button variant="danger" size="sm" onClick={disable} disabled={busy}>Sí, desactivar</Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmOff(false)}>No</Button>
              </div>
            ) : (
              <Button variant="secondary" onClick={() => setConfirmOff(true)}><ShieldOff size={16} /> Desactivar</Button>
            )}
          </>
        ) : (
          <>
            <p className="text-sm text-slate-500">
              Recomendado. Si perdés el celular con el autenticador, se puede quitar el factor desde el panel de Supabase
              (Authentication → Users → tu usuario).
            </p>
            <Button onClick={start} disabled={busy}>{busy ? "Preparando…" : "Activar doble factor"}</Button>
          </>
        )}
        {msg && <p className={cx("text-sm", msg.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-600")}>{msg.text}</p>}
      </div>
    </Card>
  );
}
