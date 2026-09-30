"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowDownRight, ArrowUpRight, CalendarClock, ChevronLeft, ChevronRight, PiggyBank, Receipt, TriangleAlert, Wallet,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTheme } from "next-themes";
import { useData, useTransactions } from "@/lib/data";
import { budgetLines, spendByRoot, totals } from "@/lib/calc";
import { daysUntil, fmtCompact, fmtDay, fmtMoney, fmtMonth, fmtMonthShort, localISO, monthKey, monthRange, shiftMonth } from "@/lib/format";
import { CatIcon } from "@/components/icons";
import { TxRow } from "@/components/TxRow";
import { useQuickAdd } from "@/components/Shell";
import { Card, CardHeader, Empty, Progress, cx } from "@/components/ui";

const INCOME_COLOR = "#2a78d6";
const EXPENSE_COLOR = "#eb6834";

export default function Dashboard() {
  const { accounts, categories, budgets, recurring, catById } = useData();
  const openTx = useQuickAdd();
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";

  const [ym, setYm] = useState(monthKey(localISO()));
  const from6 = monthRange(shiftMonth(ym, -5)).from;
  const { to } = monthRange(ym);
  const { rows, loading } = useTransactions(from6, to);

  const monthRows = useMemo(() => rows.filter((t) => monthKey(t.date) === ym), [rows, ym]);
  const t = totals(monthRows);
  const prev = totals(rows.filter((r) => monthKey(r.date) === shiftMonth(ym, -1)));
  const totalBalance = accounts.filter((a) => !a.archived).reduce((s, a) => s + a.balance, 0);

  const byCat = useMemo(() => {
    const m = spendByRoot(monthRows, catById);
    return [...m.entries()]
      .map(([id, value]) => ({
        id,
        name: catById.get(id)?.name ?? "Sin categoría",
        color: catById.get(id)?.color ?? "#64748b",
        icon: catById.get(id)?.icon ?? "tag",
        value,
      }))
      .sort((a, b) => b.value - a.value);
  }, [monthRows, catById]);

  const trend = useMemo(
    () =>
      Array.from({ length: 6 }, (_, i) => {
        const m = shiftMonth(ym, i - 5);
        const tt = totals(rows.filter((r) => monthKey(r.date) === m));
        return { m, label: fmtMonthShort(m), Ingresos: tt.income, Gastos: tt.expense };
      }),
    [rows, ym],
  );

  const lines = budgetLines(monthRows, categories, budgets, catById).filter((l) => l.budget > 0);
  const totalBudget = lines.reduce((s, l) => s + l.budget, 0);
  const alerts = lines.filter((l) => l.pct >= 80);

  const upcoming = recurring
    .filter((r) => r.active && daysUntil(r.next_date) <= 30)
    .sort((a, b) => a.next_date.localeCompare(b.next_date))
    .slice(0, 6);

  const axis = dark ? "#94a3b8" : "#64748b";
  const grid = dark ? "#1e293b" : "#eef2f7";
  const surface = dark ? "#0f172a" : "#ffffff";

  return (
    <div className="space-y-6">
      {/* Encabezado + selector de mes */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Resumen</h1>
          <p className="text-sm text-slate-500">Tu mes de un vistazo</p>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
          <button onClick={() => setYm(shiftMonth(ym, -1))} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Mes anterior">
            <ChevronLeft size={18} />
          </button>
          <span className="min-w-[140px] text-center text-sm font-semibold">{fmtMonth(ym)}</span>
          <button onClick={() => setYm(shiftMonth(ym, 1))} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Mes siguiente">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Stat
          label="Saldo total"
          value={fmtMoney(totalBalance)}
          icon={<Wallet size={18} />}
          hint={`${accounts.filter((a) => !a.archived).length} cuentas`}
          highlight
        />
        <Stat label="Ingresos" value={fmtMoney(t.income)} icon={<ArrowDownRight size={18} />} delta={pctDelta(t.income, prev.income)} />
        <Stat label="Gastos" value={fmtMoney(t.expense)} icon={<ArrowUpRight size={18} />} delta={pctDelta(t.expense, prev.expense)} invert />
        <Stat
          label="Ahorro del mes"
          value={fmtMoney(t.net)}
          icon={<PiggyBank size={18} />}
          hint={t.income > 0 ? `${Math.round((t.net / t.income) * 100)}% de tus ingresos` : "—"}
          negative={t.net < 0}
        />
      </div>

      {/* Alertas de presupuesto */}
      {alerts.length > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          <TriangleAlert size={18} className="mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold">Atención con el presupuesto: </span>
            {alerts
              .map((a) => `${a.category.name} ${a.pct >= 100 ? "superado" : "al"} ${Math.round(a.pct)}%`)
              .join(" · ")}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Gastos por categoría */}
        <Card className="lg:col-span-3">
          <CardHeader title="Gastos por categoría" subtitle={fmtMonth(ym)} />
          {byCat.length === 0 ? (
            <Empty icon={<Receipt size={22} />} title="Sin gastos este mes" text="Cargá tu primer gasto con el botón +" />
          ) : (
            <div className="grid items-center gap-2 p-5 sm:grid-cols-2">
              <div className="relative h-56">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={byCat}
                      dataKey="value"
                      nameKey="name"
                      innerRadius="68%"
                      outerRadius="100%"
                      paddingAngle={1}
                      stroke={surface}
                      strokeWidth={2}
                      isAnimationActive={false}
                    >
                      {byCat.map((c) => (
                        <Cell key={c.id} fill={c.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<MoneyTip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xs text-slate-500">Total</span>
                  <span className="text-lg font-bold tabular-nums">{fmtCompact(t.expense)}</span>
                </div>
              </div>
              <ul className="space-y-2">
                {byCat.map((c) => (
                  <li key={c.id} className="flex items-center gap-2.5 text-sm">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                    <span className="flex-1 truncate text-slate-700 dark:text-slate-300">{c.name}</span>
                    <span className="tabular-nums text-slate-500">{Math.round((c.value / (t.expense || 1)) * 100)}%</span>
                    <span className="w-24 text-right font-medium tabular-nums">{fmtMoney(c.value)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        {/* Presupuestos */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Presupuesto"
            subtitle={totalBudget > 0 ? `${fmtMoney(lines.reduce((s, l) => s + l.spent, 0))} de ${fmtMoney(totalBudget)}` : undefined}
            action={<Link href="/presupuestos" className="text-sm font-medium text-brand-600 hover:underline">Editar</Link>}
          />
          {lines.length === 0 ? (
            <Empty icon={<PiggyBank size={22} />} title="Sin presupuestos" text="Definí un límite mensual por categoría." />
          ) : (
            <ul className="space-y-4 p-5">
              {lines.slice(0, 6).map((l) => (
                <li key={l.category.id}>
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 font-medium">
                      <CatIcon icon={l.category.icon} color={l.category.color} size={13} box={24} />
                      {l.category.name}
                    </span>
                    <span className={cx("tabular-nums", l.pct >= 100 ? "font-semibold text-red-600" : "text-slate-500")}>
                      {Math.round(l.pct)}%
                    </span>
                  </div>
                  <Progress value={l.pct} color={l.category.color} />
                  <p className="mt-1 text-xs text-slate-500">
                    {l.budget - l.spent >= 0 ? `Quedan ${fmtMoney(l.budget - l.spent)}` : `Excedido ${fmtMoney(l.spent - l.budget)}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Tendencia 6 meses */}
        <Card className="lg:col-span-3">
          <CardHeader
            title="Últimos 6 meses"
            action={
              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: INCOME_COLOR }} />Ingresos</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: EXPENSE_COLOR }} />Gastos</span>
              </div>
            }
          />
          <div className="h-64 px-2 pb-4 pt-4">
            {!loading && (
              <ResponsiveContainer>
                <BarChart data={trend} barGap={2} barCategoryGap="28%">
                  <CartesianGrid vertical={false} stroke={grid} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: axis, fontSize: 12 }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fill: axis, fontSize: 12 }} tickFormatter={fmtCompact} width={56} />
                  <Tooltip content={<MoneyTip />} cursor={{ fill: dark ? "#1e293b80" : "#f1f5f9" }} />
                  <Bar dataKey="Ingresos" fill={INCOME_COLOR} radius={[4, 4, 0, 0]} maxBarSize={26} isAnimationActive={false} />
                  <Bar dataKey="Gastos" fill={EXPENSE_COLOR} radius={[4, 4, 0, 0]} maxBarSize={26} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        {/* Próximos vencimientos */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Próximos vencimientos"
            subtitle="Próximos 30 días"
            action={<Link href="/recurrentes" className="text-sm font-medium text-brand-600 hover:underline">Ver todos</Link>}
          />
          {upcoming.length === 0 ? (
            <Empty icon={<CalendarClock size={22} />} title="Nada por vencer" />
          ) : (
            <ul className="divide-y divide-slate-100 px-5 py-2 dark:divide-slate-800">
              {upcoming.map((r) => {
                const c = r.category_id ? catById.get(r.category_id) : undefined;
                const d = daysUntil(r.next_date);
                return (
                  <li key={r.id} className="flex items-center gap-3 py-2.5">
                    <CatIcon icon={c?.icon ?? "receipt"} color={c?.color ?? "#64748b"} size={15} box={32} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{r.name}</p>
                      <p className={cx("text-xs", d <= 3 ? "font-medium text-amber-600" : "text-slate-500")}>
                        {d < 0 ? `Vencido hace ${-d} d` : d === 0 ? "Hoy" : d === 1 ? "Mañana" : `${fmtDay(r.next_date)} · en ${d} días`}
                      </p>
                    </div>
                    <span className={cx("text-sm font-semibold tabular-nums", r.type === "income" && "text-emerald-600")}>
                      {fmtMoney(r.amount)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {/* Últimos movimientos */}
      <Card>
        <CardHeader
          title="Últimos movimientos"
          action={<Link href="/movimientos" className="text-sm font-medium text-brand-600 hover:underline">Ver todos</Link>}
        />
        <div className="p-3">
          {monthRows.length === 0 ? (
            <Empty
              icon={<Receipt size={22} />}
              title="Sin movimientos"
              action={<button onClick={() => openTx()} className="text-sm font-medium text-brand-600">Agregar movimiento</button>}
            />
          ) : (
            monthRows.slice(0, 8).map((tx) => <TxRow key={tx.id} tx={tx} />)
          )}
        </div>
      </Card>
    </div>
  );
}

function pctDelta(cur: number, prev: number): number | null {
  if (!prev) return null;
  return ((cur - prev) / prev) * 100;
}

function Stat({
  label, value, icon, hint, delta, invert, highlight, negative,
}: {
  label: string; value: string; icon: React.ReactNode; hint?: string; delta?: number | null; invert?: boolean; highlight?: boolean; negative?: boolean;
}) {
  const good = delta == null ? null : invert ? delta <= 0 : delta >= 0;
  return (
    <div
      className={cx(
        "rounded-2xl border p-4 shadow-card lg:p-5",
        highlight
          ? "border-transparent bg-gradient-to-br from-brand-600 to-brand-700 text-white"
          : "border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-900",
      )}
    >
      <div className="flex items-center justify-between">
        <span className={cx("text-xs font-medium uppercase tracking-wide", highlight ? "text-blue-100" : "text-slate-500")}>{label}</span>
        <span className={cx("rounded-lg p-1.5", highlight ? "bg-white/15" : "bg-slate-100 text-slate-500 dark:bg-slate-800")}>{icon}</span>
      </div>
      <p className={cx("mt-3 truncate text-xl font-bold tabular-nums lg:text-2xl", negative && "text-red-600")}>{value}</p>
      <p className={cx("mt-1 text-xs", highlight ? "text-blue-100" : "text-slate-500")}>
        {delta != null ? (
          <span className={good ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
            {delta >= 0 ? "▲" : "▼"} {Math.abs(Math.round(delta))}% vs mes anterior
          </span>
        ) : (
          hint ?? " "
        )}
      </p>
    </div>
  );
}

type TipProps = { active?: boolean; payload?: { name?: string; value?: number; color?: string; payload?: { color?: string } }[]; label?: string };
function MoneyTip({ active, payload, label }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800">
      {label && <p className="mb-1 font-semibold text-slate-900 dark:text-white">{label}</p>}
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
          <span className="h-2 w-2 rounded-full" style={{ background: p.payload?.color ?? p.color }} />
          {p.name}: <span className="font-semibold tabular-nums text-slate-900 dark:text-white">{fmtMoney(Number(p.value))}</span>
        </p>
      ))}
    </div>
  );
}
