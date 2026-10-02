"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTheme } from "next-themes";
import { CreditCard, FileUp, Pencil, Plus, TriangleAlert } from "lucide-react";
import { useData } from "@/lib/data";
import { daysUntil, fmtCompact, fmtDay, fmtMoney, localISO } from "@/lib/format";
import { payProjection, planStatus, type InstallmentPlan } from "@/lib/installments";
import { fmtYM, fmtYMShort } from "@/lib/months";
import { StatementUpload } from "@/components/StatementUpload";
import { PlanModal } from "@/components/PlanModal";
import { Button, Card, CardHeader, Empty, PageHeader, Progress, cx } from "@/components/ui";

const BAR = "#2a78d6";
const BAR_NOW = "#1d4ed8";

export default function Cuotas() {
  const { plans, statements, accounts, cuotasReady, hidden } = useData();
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const [upload, setUpload] = useState(false);
  const [planModal, setPlanModal] = useState<{ open: boolean; plan: InstallmentPlan | null }>({ open: false, plan: null });
  const [showDone, setShowDone] = useState(false);
  const today = localISO();

  const status = useMemo(() => plans.map((p) => planStatus(p, statements, today)), [plans, statements, today]);
  const active = status.filter((s) => !s.finished).sort((a, b) => a.endPayMonth.localeCompare(b.endPayMonth));
  const done = status.filter((s) => s.finished);
  const proj = useMemo(() => payProjection(plans, statements, 12, today), [plans, statements, today]);
  const toPay = active.reduce((s, x) => s + (x.plan.currency === "ARS" ? x.toPayAmount : 0), 0);
  const last = active.reduce<(typeof active)[number] | null>((m, x) => (!m || x.endPayMonth > m.endPayMonth ? x : m), null);
  const lastIdx = proj.reduce((i, r, k) => (r.amount > 0 ? k : i), -1);
  const chart = proj.slice(0, Math.max(6, lastIdx + 1)).map((r) => ({ ...r, label: fmtYMShort(r.month) }));

  // Último resumen por tarjeta
  const latest = useMemo(() => {
    const m = new Map<string, (typeof statements)[number]>();
    for (const s of statements) if (!m.has(s.account_id)) m.set(s.account_id, s);
    return [...m.values()];
  }, [statements]);
  const accName = (id: string) => accounts.find((a) => a.id === id)?.name ?? "Tarjeta";

  if (!cuotasReady) {
    return (
      <div>
        <PageHeader title="Cuotas de tarjeta" />
        <Card className="p-5">
          <div className="flex gap-3 text-sm">
            <TriangleAlert className="shrink-0 text-amber-500" size={20} />
            <div>
              <p className="font-semibold">Falta un paso en la base de datos</p>
              <p className="mt-1 text-slate-600 dark:text-slate-300">
                Ejecutá <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">supabase/migrations/003_cuotas.sql</code> en el SQL Editor de Supabase y recargá la página.
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Cuotas de tarjeta"
        subtitle="Subí el resumen todos los meses: actualiza en qué cuota vas, sin duplicar compras."
        action={
          <div className="flex w-full gap-2 sm:w-auto">
            <Button size="sm" className="flex-1 sm:flex-none" onClick={() => setUpload(true)}>
              <FileUp size={15} /> Subir resumen
            </Button>
            <Button size="sm" variant="secondary" className="flex-1 sm:flex-none" onClick={() => setPlanModal({ open: true, plan: null })}>
              <Plus size={15} /> A mano
            </Button>
          </div>
        }
      />

      {plans.length === 0 ? (
        <Card>
          <Empty
            icon={<CreditCard size={22} />}
            title="Todavía no cargaste cuotas"
            text="Subí el PDF del resumen de tu tarjeta (o una captura) y la app detecta las compras en cuotas, cuánto pagás cada mes y cuándo terminás."
            action={<Button onClick={() => setUpload(true)}><FileUp size={16} /> Subir resumen</Button>}
          />
        </Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Pagás este mes" value={fmtMoney(proj[0]?.amount ?? 0)} hint={`${proj[0]?.items.length ?? 0} cuotas`} strong />
            <Kpi label="El mes que viene" value={fmtMoney(proj[1]?.amount ?? 0)} hint={proj[1] ? fmtYM(proj[1].month) : undefined} />
            <Kpi label="Te falta pagar" value={fmtMoney(toPay)} hint={`${active.length} compras activas`} />
            <Kpi label="Terminás de pagar" value={last ? fmtYM(last.endPayMonth) : "—"} hint={last ? `Última: ${last.plan.description}` : undefined} />
          </div>

          <div className="mb-6 grid gap-4 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader title="Cuánto pagás cada mes" subtitle="Cuotas que vencen en cada resumen" />
              <div className="h-64 px-2 pb-4 pt-4">
                <ResponsiveContainer>
                  <BarChart key={hidden ? "h" : "v"} data={chart} barCategoryGap="22%">
                    <CartesianGrid vertical={false} stroke={dark ? "#1e293b" : "#eef2f7"} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: dark ? "#94a3b8" : "#64748b", fontSize: 12 }} />
                    <YAxis tickLine={false} axisLine={false} width={56} tick={{ fill: dark ? "#94a3b8" : "#64748b", fontSize: 12 }} tickFormatter={(v: number) => fmtCompact(v)} />
                    <Tooltip cursor={{ fill: dark ? "#1e293b80" : "#f1f5f9" }} content={<ProjTip />} />
                    <Bar dataKey="amount" radius={[4, 4, 0, 0]} maxBarSize={30} isAnimationActive={false}>
                      {chart.map((r, i) => <Cell key={r.month} fill={i === 0 ? BAR_NOW : BAR} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader title="Último resumen" />
              <div className="space-y-4 p-5">
                {latest.length === 0 && <p className="text-sm text-slate-500">Cargaste cuotas a mano. Subí un resumen para ver vencimientos y saldo.</p>}
                {latest.map((s) => {
                  const d = s.due_date ? daysUntil(s.due_date) : null;
                  return (
                    <div key={s.id} className="space-y-2 text-sm">
                      <p className="font-semibold">
                        {s.issuer ?? accName(s.account_id)} {s.card_last4 && <span className="text-slate-400">•••• {s.card_last4}</span>}
                      </p>
                      <Row k="Cierre" v={fmtDay(s.closing_date)} />
                      {s.due_date && (
                        <Row k="Vence" v={<span className={cx(d !== null && d >= 0 && d <= 5 && "font-semibold text-amber-600")}>{fmtDay(s.due_date)}{d !== null && d >= 0 ? ` · en ${d} d` : ""}</span>} />
                      )}
                      {s.balance != null && <Row k="Saldo a pagar" v={<b className="tabular-nums">{fmtMoney(s.balance)}</b>} />}
                      {s.min_payment != null && <Row k="Pago mínimo" v={fmtMoney(s.min_payment)} />}
                      {s.next_closing && <Row k="Próximo cierre" v={fmtDay(s.next_closing)} />}
                      {s.next_due && <Row k="Próximo vencimiento" v={fmtDay(s.next_due)} />}
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          <Card className="p-2">
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {active.map((s) => <PlanRow key={s.plan.id} s={s} onEdit={() => setPlanModal({ open: true, plan: s.plan })} />)}
            </ul>
            {done.length > 0 && (
              <div className="border-t border-slate-100 p-3 dark:border-slate-800">
                <button onClick={() => setShowDone(!showDone)} className="text-sm font-medium text-slate-500 hover:text-slate-700">
                  {showDone ? "Ocultar" : "Ver"} terminadas ({done.length})
                </button>
                {showDone && (
                  <ul className="mt-2 divide-y divide-slate-100 opacity-60 dark:divide-slate-800">
                    {done.map((s) => <PlanRow key={s.plan.id} s={s} onEdit={() => setPlanModal({ open: true, plan: s.plan })} />)}
                  </ul>
                )}
              </div>
            )}
          </Card>
        </>
      )}

      <StatementUpload open={upload} onClose={() => setUpload(false)} />
      <PlanModal open={planModal.open} plan={planModal.plan} onClose={() => setPlanModal({ open: false, plan: null })} />
    </div>
  );
}

function PlanRow({ s, onEdit }: { s: ReturnType<typeof planStatus>; onEdit: () => void }) {
  const p = s.plan;
  const shown = Math.max(1, Math.min(p.installments_total, s.thisMonthCuota ?? s.billed));
  return (
    <li className="px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{p.description}</p>
          <p className="text-xs text-slate-500">
            {s.finished ? `Terminada en ${fmtYM(s.endPayMonth)}` : `Cuota ${shown} de ${p.installments_total} · última en ${fmtYM(s.endPayMonth)}`}
            {p.currency === "USD" && " · en dólares"}
            {p.source === "manual" && " · cargada a mano"}
          </p>
        </div>
        <div className="flex shrink-0 items-start gap-1">
          <div className="text-right">
            <p className="font-semibold tabular-nums">{p.currency === "USD" ? `US$ ${p.installment_amount}` : fmtMoney(p.installment_amount)}</p>
            {!s.finished && <p className="text-xs text-slate-500">faltan {s.toPay} · {fmtMoney(s.toPayAmount)}</p>}
          </div>
          <button onClick={onEdit} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Editar">
            <Pencil size={14} />
          </button>
        </div>
      </div>
      <div className="mt-2">
        <Progress plain value={(shown / p.installments_total) * 100} color={s.finished || shown === p.installments_total ? "#1baf7a" : "#2a78d6"} />
      </div>
    </li>
  );
}

function Kpi({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className={cx("rounded-2xl border p-4 shadow-card", strong ? "border-transparent bg-gradient-to-br from-brand-600 to-brand-700 text-white" : "border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-900")}>
      <p className={cx("text-xs font-medium uppercase tracking-wide", strong ? "text-blue-100" : "text-slate-500")}>{label}</p>
      <p className="mt-2 truncate text-lg font-bold tabular-nums sm:text-xl">{value}</p>
      {hint && <p className={cx("mt-0.5 truncate text-xs", strong ? "text-blue-100" : "text-slate-500")}>{hint}</p>}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-500">{k}</span>
      <span>{v}</span>
    </div>
  );
}

type TipP = { active?: boolean; payload?: { payload: { month: string; amount: number; items: { d: string; k: number; t: number; a: number }[] } }[] };
function ProjTip({ active, payload }: TipP) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="max-w-[260px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800">
      <p className="mb-1 font-semibold text-slate-900 dark:text-white">
        {fmtYM(r.month)}: {fmtMoney(r.amount)}
      </p>
      {r.items.map((i, k) => (
        <p key={k} className="flex justify-between gap-3 text-slate-600 dark:text-slate-300">
          <span className="truncate">{i.d} ({i.k}/{i.t})</span>
          <span className="tabular-nums">{fmtMoney(i.a)}</span>
        </p>
      ))}
      {!r.items.length && <p className="text-slate-500">Sin cuotas</p>}
    </div>
  );
}

