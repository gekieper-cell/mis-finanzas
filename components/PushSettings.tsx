"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, Check, Send } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Button, Card, CardHeader, Select, cx } from "./ui";

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

interface Settings {
  due_alerts: boolean;
  card_alerts: boolean;
  budget_alerts: boolean;
  due_days: number;
  show_amounts: boolean;
}
const DEFAULTS: Settings = { due_alerts: true, card_alerts: true, budget_alerts: true, due_days: 2, show_amounts: false };

type Support = "ok" | "ios-install" | "unsupported" | "no-config";

function b64ToBytes(b64: string) {
  const s = atob((b64 + "===".slice((b64.length + 3) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

function detect(): Support {
  if (!VAPID) return "no-config";
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window))
    return ios && !standalone ? "ios-install" : "unsupported";
  return "ok";
}

async function currentSub() {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

export function PushSettings() {
  const [support, setSupport] = useState<Support | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [perm, setPerm] = useState<NotificationPermission | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const sp = detect();
    setSupport(sp);
    const { data } = await supabaseBrowser().from("notification_settings").select("*").maybeSingle();
    if (data) setSettings({ ...DEFAULTS, ...data });
    if (sp !== "ok") return;
    setPerm(Notification.permission);
    const sub = await currentSub();
    if (sub) {
      // ¿Sigue registrada en la base? (puede haberse borrado por vencida)
      const { data: row } = await supabaseBrowser().from("push_subscriptions").select("id").eq("endpoint", sub.endpoint).maybeSingle();
      setSubscribed(!!row);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function enable() {
    setBusy(true);
    setMsg(null);
    try {
      const p = await Notification.requestPermission();
      setPerm(p);
      if (p !== "granted") {
        setMsg({ ok: false, text: p === "denied" ? "Los avisos están bloqueados. Habilitalos en Ajustes del iPhone → Notificaciones → Mis Finanzas." : "No diste permiso." });
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID) }));
      const j = sub.toJSON();
      if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) throw new Error("suscripción incompleta");
      const { error } = await supabaseBrowser().from("push_subscriptions").upsert(
        { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent.slice(0, 200) },
        { onConflict: "endpoint" },
      );
      if (error) throw new Error(error.message);
      await saveSettings(settings, true);
      setSubscribed(true);
      setMsg({ ok: true, text: "Avisos activados en este dispositivo. Llegan a las 9:00." });
    } catch (e) {
      setMsg({ ok: false, text: `No se pudo activar: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMsg(null);
    try {
      const sub = await currentSub();
      if (sub) {
        await supabaseBrowser().from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        await sub.unsubscribe();
      }
      setSubscribed(false);
      setMsg({ ok: true, text: "Avisos desactivados en este dispositivo." });
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(next: Settings, silent = false) {
    setSettings(next);
    const { error } = await supabaseBrowser()
      .from("notification_settings")
      .upsert({ ...next, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error && !silent) setMsg({ ok: false, text: `No se guardó: ${error.message}` });
  }

  async function test() {
    setBusy(true);
    setMsg(null);
    const { error } = await supabaseBrowser().rpc("send_test_push");
    setBusy(false);
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: "Enviada. Debería llegar en unos segundos." });
  }

  const toggle = (k: keyof Settings) => saveSettings({ ...settings, [k]: !settings[k] });

  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title={<span className="flex items-center gap-2"><Bell size={18} /> Avisos</span>}
        subtitle="Vencimientos, tarjeta y presupuestos. Un resumen por día, a las 9:00."
        action={support === "ok" && <Status on={subscribed} />}
      />
      <div className="space-y-4 p-5">
        {support === "ios-install" && (
          <Note>En iPhone los avisos funcionan solo con la app instalada: Safari → Compartir → <b>Agregar a inicio</b>, y abrila desde el ícono (iOS 16.4 o más nuevo).</Note>
        )}
        {support === "unsupported" && <Note>Este navegador no admite avisos push.</Note>}
        {support === "no-config" && <Note>Falta configurar los avisos en el servidor (script <b>configurar-avisos.ps1</b>).</Note>}

        <div className="grid gap-2 sm:grid-cols-2">
          <Toggle on={settings.due_alerts} onClick={() => toggle("due_alerts")} label="Gastos fijos y débitos por vencer" />
          <Toggle on={settings.card_alerts} onClick={() => toggle("card_alerts")} label="Vencimiento de la tarjeta" />
          <Toggle on={settings.budget_alerts} onClick={() => toggle("budget_alerts")} label="Presupuesto al 80% y al 100%" />
          <Toggle on={settings.show_amounts} onClick={() => toggle("show_amounts")} label="Mostrar montos en el aviso" hint="Se ven con el celular bloqueado" />
        </div>
        <label className="flex flex-wrap items-center gap-3 text-sm">
          Avisar vencimientos con
          <div className="w-48">
            <Select value={settings.due_days} onChange={(e) => saveSettings({ ...settings, due_days: Number(e.target.value) })}>
              {[0, 1, 2, 3, 5, 7].map((d) => <option key={d} value={d}>{d === 0 ? "el mismo día" : `${d} día${d > 1 ? "s" : ""} antes`}</option>)}
            </Select>
          </div>
        </label>

        {support === "ok" && (
          <div className="flex flex-wrap gap-2">
            {subscribed ? (
              <>
                <Button variant="secondary" onClick={test} disabled={busy}><Send size={15} /> Enviar prueba</Button>
                <Button variant="ghost" onClick={disable} disabled={busy}><BellOff size={15} /> Desactivar en este dispositivo</Button>
              </>
            ) : (
              <Button onClick={enable} disabled={busy || perm === "denied"}><Bell size={15} /> {busy ? "Activando…" : "Activar avisos en este dispositivo"}</Button>
            )}
          </div>
        )}
        {msg && <p className={cx("text-sm", msg.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-600")}>{msg.text}</p>}
      </div>
    </Card>
  );
}

function Status({ on }: { on: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
      on ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}>
      {on ? <><Check size={13} /> Activos</> : "Inactivos"}
    </span>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{children}</p>;
}

function Toggle({ on, onClick, label, hint }: { on: boolean; onClick: () => void; label: string; hint?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onClick}
      className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-left text-sm dark:border-slate-700">
      <span>
        {label}
        {hint && <span className="block text-xs text-slate-400">{hint}</span>}
      </span>
      <span className={cx("relative h-6 w-10 shrink-0 rounded-full transition", on ? "bg-brand-600" : "bg-slate-300 dark:bg-slate-600")}>
        <span className={cx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", on ? "left-[18px]" : "left-0.5")} />
      </span>
    </button>
  );
}
