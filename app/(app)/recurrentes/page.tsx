"use client";

import { useState } from "react";
import { Check, Pencil, Plus, Repeat, Trash2 } from "lucide-react";
import { useData } from "@/lib/data";
import { monthlyCost } from "@/lib/calc";
import { daysUntil, fmtDay, fmtMoney, localISO, parseAmount, parseISO } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import { FREQUENCIES, type Frequency, type Recurring } from "@/lib/types";
import { CatIcon } from "@/components/icons";
import { Button, Card, Empty, Field, Input, Modal, PageHeader, Segmented, Select, cx } from "@/components/ui";

export default function Recurrentes() {
  const sb = supabaseBrowser();
  const { recurring, catById, accById, bump } = useData();
  const [tab, setTab] = useState<"all" | "subs">("all");
  const [modal, setModal] = useState<{ open: boolean; initial: Recurring | null }>({ open: false, initial: null });
  const [posting, setPosting] = useState<string | null>(null);

  const active = recurring.filter((r) => r.active);
  const fixedExpense = active.filter((r) => r.type === "expense").reduce((s, r) => s + monthlyCost(r), 0);
  const fixedIncome = active.filter((r) => r.type === "income").reduce((s, r) => s + monthlyCost(r), 0);
  const subs = active.filter((r) => r.is_subscription && r.type === "expense");
  const subsMonthly = subs.reduce((s, r) => s + monthlyCost(r), 0);
  const list = (tab === "subs" ? recurring.filter((r) => r.is_subscription) : recurring).slice().sort((a, b) =>
    a.active === b.active ? a.next_date.localeCompare(b.next_date) : a.active ? -1 : 1,
  );

  async function post(r: Recurring) {
    setPosting(r.id);
    const { error } = await sb.rpc("post_recurring", { rid: r.id });
    setPosting(null);
    if (error) alert(error.message);
    else bump();
  }

  return (
    <div>
      <PageHeader
        title="Recurrentes y suscripciones"
        subtitle="Gastos fijos, sueldos y suscripciones. Los marcados como automáticos se registran solos al vencer."
        action={<Button size="sm" onClick={() => setModal({ open: true, initial: null })}><Plus size={15} /> Nuevo</Button>}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Gastos fijos / mes" value={fmtMoney(fixedExpense)} />
        <Kpi label="Ingresos fijos / mes" value={fmtMoney(fixedIncome)} good />
        <Kpi label="Suscripciones / mes" value={fmtMoney(subsMonthly)} hint={`${subs.length} activas`} />
        <Kpi label="Suscripciones / año" value={fmtMoney(subsMonthly * 12)} />
      </div>

      <Segmented className="mb-4" value={tab} onChange={setTab} options={[{ value: "all", label: "Todos" }, { value: "subs", label: "Suscripciones" }]} />

      <Card className="p-2">
        {list.length === 0 ? (
          <Empty icon={<Repeat size={22} />} title="Nada cargado todavía" text="Agregá alquiler, servicios, sueldo, Netflix, Spotify…"
            action={<Button size="sm" onClick={() => setModal({ open: true, initial: null })}><Plus size={15} /> Agregar</Button>} />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {list.map((r) => {
              const c = r.category_id ? catById.get(r.category_id) : undefined;
              const d = daysUntil(r.next_date);
              // Débito automático en tarjeta: llega con el resumen, no se registra a mano
              const onCard = accById.get(r.account_id)?.type === "card";
              return (
                <li key={r.id} className={cx("px-3 py-3", !r.active && "opacity-50")}>
                  <div className="flex items-start gap-3">
                    <CatIcon icon={c?.icon ?? "receipt"} color={c?.color ?? "#64748b"} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 truncate font-medium">{r.name}</p>
                        <span className={cx("shrink-0 font-semibold tabular-nums", r.type === "income" && "text-emerald-600")}>
                          {r.type === "income" ? "+" : ""}{fmtMoney(r.amount)}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {r.is_subscription && <span className="rounded-md bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">Suscripción</span>}
                        {r.auto_post && r.active && !onCard && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">Auto</span>}
                        {onCard && <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-brand-700 dark:bg-brand-600/20 dark:text-brand-100">En tarjeta</span>}
                        <span className="text-xs text-slate-500">
                          {FREQUENCIES[r.frequency]} · {accById.get(r.account_id)?.name}
                          {r.active && (
                            <span className={cx(d <= 3 && "font-medium text-amber-600")}>
                              {" "}· próximo {d === 0 ? "hoy" : d === 1 ? "mañana" : fmtDay(r.next_date)}
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="mt-2 flex gap-1">
                        {r.active && !onCard && (
                          <Button size="sm" variant="secondary" onClick={() => post(r)} disabled={posting === r.id} title="Registrar el pago de esta fecha y avanzar al próximo">
                            <Check size={14} /> Registrar
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setModal({ open: true, initial: r })} aria-label="Editar"><Pencil size={14} /> Editar</Button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <RecurringModal {...modal} onClose={() => setModal({ open: false, initial: null })} />
    </div>
  );
}

function Kpi({ label, value, hint, good }: { label: string; value: string; hint?: string; good?: boolean }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cx("mt-2 truncate text-xl font-bold tabular-nums", good && "text-emerald-600")}>{value}</p>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </Card>
  );
}

function RecurringModal({ open, onClose, initial }: { open: boolean; onClose: () => void; initial: Recurring | null }) {
  const sb = supabaseBrowser();
  const { accounts, categories, bump } = useData();
  const [f, setF] = useState({
    name: "", type: "expense" as "expense" | "income", amount: "", account_id: "", category_id: "",
    frequency: "monthly" as Frequency, next_date: localISO(), is_subscription: false, auto_post: true, active: true,
  });
  const [err, setErr] = useState<string | null>(null);
  const [lastKey, setLastKey] = useState<string | null>(null);

  const key = open ? initial?.id ?? "new" : null;
  if (key !== lastKey) {
    setLastKey(key);
    if (open) {
      setErr(null);
      setF({
        name: initial?.name ?? "",
        type: initial?.type ?? "expense",
        amount: initial ? String(initial.amount).replace(".", ",") : "",
        account_id: initial?.account_id ?? accounts.find((a) => !a.archived)?.id ?? "",
        category_id: initial?.category_id ?? "",
        frequency: initial?.frequency ?? "monthly",
        next_date: initial?.next_date ?? localISO(),
        is_subscription: initial?.is_subscription ?? false,
        auto_post: initial?.auto_post ?? true,
        active: initial?.active ?? true,
      });
    }
  }
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  const cats = categories.filter((c) => c.kind === f.type && !c.archived);
  const roots = cats.filter((c) => !c.parent_id);

  async function save() {
    const amount = parseAmount(f.amount);
    if (!f.name.trim()) return setErr("Poné un nombre");
    if (!(amount > 0)) return setErr("Monto inválido");
    if (!f.account_id) return setErr("Elegí una cuenta");
    const payload = {
      name: f.name.trim(), type: f.type, amount, account_id: f.account_id, category_id: f.category_id || null,
      frequency: f.frequency, next_date: f.next_date,
      anchor_day: f.frequency === "weekly" ? null : parseISO(f.next_date).getDate(),
      is_subscription: f.is_subscription, auto_post: f.auto_post, active: f.active,
    };
    const { error } = initial
      ? await sb.from("recurring").update(payload).eq("id", initial.id)
      : await sb.from("recurring").insert(payload);
    if (error) return setErr(error.message);
    // Si ya venció y es automático, registrarlo ya
    if (f.auto_post) await sb.rpc("process_recurring");
    bump();
    onClose();
  }

  async function remove() {
    if (!initial || !confirm(`¿Eliminar "${initial.name}"? Los movimientos ya registrados se conservan.`)) return;
    const { error } = await sb.from("recurring").delete().eq("id", initial.id);
    if (error) return setErr(error.message);
    bump();
    onClose();
  }

  const Toggle = ({ k, label, hint }: { k: "is_subscription" | "auto_post" | "active"; label: string; hint: string }) => (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <input type="checkbox" checked={f[k]} onChange={(e) => set(k, e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-600" />
      <span><span className="block text-sm font-medium">{label}</span><span className="text-xs text-slate-500">{hint}</span></span>
    </label>
  );

  return (
    <Modal open={open} onClose={onClose} title={initial ? "Editar recurrente" : "Nuevo recurrente"}>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-4">
        <Segmented className="w-full" value={f.type} onChange={(v) => { set("type", v); set("category_id", ""); }}
          options={[{ value: "expense", label: "Gasto", activeClass: "text-red-600" }, { value: "income", label: "Ingreso", activeClass: "text-emerald-600" }]} />
        <Field label="Nombre"><Input value={f.name} maxLength={80} onChange={(e) => set("name", e.target.value)} placeholder="Ej: Netflix, Alquiler, Sueldo" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Monto"><Input inputMode="decimal" value={f.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0" /></Field>
          <Field label="Frecuencia">
            <Select value={f.frequency} onChange={(e) => set("frequency", e.target.value as Frequency)}>
              {Object.entries(FREQUENCIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Próxima fecha"><Input type="date" value={f.next_date} onChange={(e) => set("next_date", e.target.value)} /></Field>
          <Field label="Cuenta">
            <Select value={f.account_id} onChange={(e) => set("account_id", e.target.value)}>
              {accounts.filter((a) => !a.archived).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Categoría">
          <Select value={f.category_id} onChange={(e) => set("category_id", e.target.value)}>
            <option value="">— Sin categoría —</option>
            {roots.map((r) => (
              <optgroup key={r.id} label={r.name}>
                <option value={r.id}>{r.name}</option>
                {cats.filter((c) => c.parent_id === r.id).map((c) => <option key={c.id} value={c.id}>↳ {c.name}</option>)}
              </optgroup>
            ))}
          </Select>
        </Field>
        <div className="space-y-2">
          <Toggle k="auto_post" label="Registrar automáticamente" hint="Al abrir la app, crea el movimiento cuando llega la fecha." />
          <Toggle k="is_subscription" label="Es una suscripción" hint="Aparece en el panel de suscripciones." />
          {initial && <Toggle k="active" label="Activo" hint="Desactivalo si lo diste de baja." />}
        </div>
        {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">{err}</p>}
        <div className="flex gap-2">
          {initial && <Button type="button" variant="secondary" onClick={remove} title="Eliminar"><Trash2 size={16} className="text-red-600" /></Button>}
          <Button type="submit" className="flex-1">Guardar</Button>
        </div>
      </form>
    </Modal>
  );
}
