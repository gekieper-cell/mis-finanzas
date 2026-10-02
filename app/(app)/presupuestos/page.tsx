"use client";

import { useMemo, useState } from "react";
import { Archive, ChevronLeft, ChevronRight, Pencil, Plus } from "lucide-react";
import { useData, useTransactions } from "@/lib/data";
import { budgetLines, spendByRoot } from "@/lib/calc";
import { fmtMoney, fmtMonth, localISO, monthKey, monthRange, parseAmount, shiftMonth } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Category, CategoryKind } from "@/lib/types";
import { CATEGORY_ICONS, CatIcon, PALETTE } from "@/components/icons";
import { Button, Card, CardHeader, Field, Input, Modal, PageHeader, Progress, Segmented, Select, cx } from "@/components/ui";
import { payProjection } from "@/lib/installments";
import Link from "next/link";
import { CreditCard } from "lucide-react";

export default function Presupuestos() {
  const { categories, budgets, catById, plans, statements } = useData();
  const cuotasMes = payProjection(plans, statements, 1)[0];
  const [ym, setYm] = useState(monthKey(localISO()));
  const { from, to } = monthRange(ym);
  const { rows } = useTransactions(from, to);
  const [catModal, setCatModal] = useState<{ open: boolean; initial: Category | null; kind: CategoryKind; parent: string | null }>({
    open: false, initial: null, kind: "expense", parent: null,
  });

  const lines = budgetLines(rows, categories, budgets, catById);
  const totalBudget = lines.reduce((s, l) => s + l.budget, 0);
  const totalSpent = lines.reduce((s, l) => s + l.spent, 0);
  const incomeByRoot = useMemo(() => spendByRoot(rows, catById, "income"), [rows, catById]);
  const subSpend = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((t) => t.type === "expense" && t.category_id && m.set(t.category_id, (m.get(t.category_id) ?? 0) + t.amount));
    return m;
  }, [rows]);

  const openCat = (initial: Category | null, kind: CategoryKind, parent: string | null = null) =>
    setCatModal({ open: true, initial, kind, parent });

  return (
    <div>
      <PageHeader
        title="Presupuestos y categorías"
        subtitle="Límite mensual por categoría. Las subcategorías suman a su categoría principal."
        action={
          <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
            <button onClick={() => setYm(shiftMonth(ym, -1))} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Mes anterior"><ChevronLeft size={18} /></button>
            <span className="min-w-[140px] text-center text-sm font-semibold">{fmtMonth(ym)}</span>
            <button onClick={() => setYm(shiftMonth(ym, 1))} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Mes siguiente"><ChevronRight size={18} /></button>
          </div>
        }
      />

      {cuotasMes && cuotasMes.amount > 0 && (
        <Link href="/cuotas" className="mb-4 flex items-center gap-3 rounded-2xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-800 dark:border-brand-600/30 dark:bg-brand-600/10 dark:text-brand-100">
          <CreditCard size={18} className="shrink-0" />
          <span>
            Este mes ya tenés comprometidos <b className="tabular-nums">{fmtMoney(cuotasMes.amount)}</b> en {cuotasMes.items.length} cuotas de tarjeta.
          </span>
          <span className="ml-auto shrink-0 font-medium">Ver →</span>
        </Link>
      )}

      <Card className="mb-6 p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Gastado / presupuestado</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {fmtMoney(totalSpent)} <span className="text-base font-medium text-slate-400">/ {fmtMoney(totalBudget)}</span>
            </p>
          </div>
          <p className={cx("text-sm font-medium", totalSpent > totalBudget && totalBudget > 0 ? "text-red-600" : "text-slate-500")}>
            {totalBudget > 0 ? (totalBudget - totalSpent >= 0 ? `Quedan ${fmtMoney(totalBudget - totalSpent)}` : `Excedido ${fmtMoney(totalSpent - totalBudget)}`) : "Definí montos abajo"}
          </p>
        </div>
        <div className="mt-3"><Progress value={totalBudget ? (totalSpent / totalBudget) * 100 : 0} /></div>
      </Card>

      <Card className="mb-6">
        <CardHeader title="Gastos" action={<Button size="sm" variant="secondary" onClick={() => openCat(null, "expense")}><Plus size={15} /> Categoría</Button>} />
        <ul className="divide-y divide-slate-100 p-2 dark:divide-slate-800">
          {lines.map((l) => {
            const subs = categories.filter((c) => c.parent_id === l.category.id && !c.archived);
            return (
              <li key={l.category.id} className="px-3 py-4">
                <div className="flex flex-wrap items-center gap-3">
                  <CatIcon icon={l.category.icon} color={l.category.color} />
                  <div className="min-w-[140px] flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="font-medium">{l.category.name}</p>
                      <button onClick={() => openCat(l.category, "expense")} className="rounded p-1 text-slate-400 hover:text-slate-600" aria-label="Editar categoría"><Pencil size={13} /></button>
                    </div>
                    <p className="text-xs text-slate-500">Gastado {fmtMoney(l.spent)}{l.budget > 0 && ` · ${Math.round(l.pct)}%`}</p>
                  </div>
                  <BudgetInput categoryId={l.category.id} value={l.budget} />
                </div>
                {l.budget > 0 && <div className="mt-3"><Progress value={l.pct} color={l.category.color} /></div>}
                <div className="mt-3 flex flex-wrap gap-1.5 pl-12">
                  {subs.map((s) => (
                    <button key={s.id} onClick={() => openCat(s, "expense", l.category.id)}
                      className="rounded-full border border-slate-200 px-2.5 py-0.5 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                      {s.name} <span className="text-slate-400">{fmtMoney(subSpend.get(s.id) ?? 0)}</span>
                    </button>
                  ))}
                  <button onClick={() => openCat(null, "expense", l.category.id)} className="rounded-full border border-dashed border-slate-300 px-2.5 py-0.5 text-xs text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                    + subcategoría
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Ingresos" action={<Button size="sm" variant="secondary" onClick={() => openCat(null, "income")}><Plus size={15} /> Categoría</Button>} />
        <ul className="divide-y divide-slate-100 p-2 dark:divide-slate-800">
          {categories.filter((c) => c.kind === "income" && !c.parent_id && !c.archived).map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-3">
              <CatIcon icon={c.icon} color={c.color} />
              <span className="flex-1 font-medium">{c.name}</span>
              <span className="text-sm tabular-nums text-emerald-600">{fmtMoney(incomeByRoot.get(c.id) ?? 0)}</span>
              <button onClick={() => openCat(c, "income")} className="rounded p-1 text-slate-400 hover:text-slate-600" aria-label="Editar"><Pencil size={14} /></button>
            </li>
          ))}
        </ul>
      </Card>

      <CategoryModal {...catModal} onClose={() => setCatModal((s) => ({ ...s, open: false }))} />
    </div>
  );
}

function BudgetInput({ categoryId, value }: { categoryId: string; value: number }) {
  const sb = supabaseBrowser();
  const { bump, hidden } = useData();
  const [v, setV] = useState(value ? value.toLocaleString("es-AR") : "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function commit() {
    const amt = v.trim() === "" ? 0 : parseAmount(v);
    if (!Number.isFinite(amt) || amt < 0) return setState("error");
    if (amt === value) return;
    setState("saving");
    const { error } =
      amt === 0
        ? await sb.from("budgets").delete().eq("category_id", categoryId)
        : await sb.from("budgets").upsert({ category_id: categoryId, amount: amt }, { onConflict: "user_id,category_id" });
    if (error) return setState("error");
    setV(amt ? amt.toLocaleString("es-AR") : "");
    setState("saved");
    bump();
    setTimeout(() => setState("idle"), 1500);
  }

  if (hidden) {
    return (
      <div className="flex h-10 w-40 items-center justify-end rounded-xl border border-slate-200 px-3 text-sm text-slate-400 dark:border-slate-700">
        {value ? fmtMoney(value) : "Sin límite"}
      </div>
    );
  }

  return (
    <div className="relative w-40">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
      <Input
        inputMode="decimal"
        value={v}
        placeholder="Sin límite"
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className={cx("pl-7 text-right tabular-nums", state === "error" && "border-red-400", state === "saved" && "border-emerald-400")}
        aria-label="Presupuesto mensual"
      />
    </div>
  );
}

function CategoryModal({
  open, onClose, initial, kind, parent,
}: { open: boolean; onClose: () => void; initial: Category | null; kind: CategoryKind; parent: string | null }) {
  const sb = supabaseBrowser();
  const { categories, bump } = useData();
  const [name, setName] = useState("");
  const [k, setK] = useState<CategoryKind>("expense");
  const [parentId, setParentId] = useState<string>("");
  const [color, setColor] = useState(PALETTE[0]);
  const [icon, setIcon] = useState("tag");
  const [err, setErr] = useState<string | null>(null);
  const [lastKey, setLastKey] = useState<string | null>(null);

  const key = open ? `${initial?.id ?? "new"}-${kind}-${parent}` : null;
  if (key !== lastKey) {
    setLastKey(key);
    if (open) {
      const par = parent ? categories.find((c) => c.id === parent) : undefined;
      setName(initial?.name ?? "");
      setK(initial?.kind ?? kind);
      setParentId(initial?.parent_id ?? parent ?? "");
      setColor(initial?.color ?? par?.color ?? PALETTE[0]);
      setIcon(initial?.icon ?? par?.icon ?? "tag");
      setErr(null);
    }
  }

  const roots = categories.filter((c) => c.kind === k && !c.parent_id && !c.archived && c.id !== initial?.id);
  const hasChildren = !!initial && categories.some((c) => c.parent_id === initial.id);

  async function save() {
    if (!name.trim()) return setErr("Poné un nombre");
    const payload = { name: name.trim(), kind: k, parent_id: parentId || null, color, icon };
    const { error } = initial
      ? await sb.from("categories").update(payload).eq("id", initial.id)
      : await sb.from("categories").insert(payload);
    if (error) return setErr(error.message);
    bump();
    onClose();
  }

  async function archive() {
    if (!initial || !confirm(`¿Archivar "${initial.name}"? Los movimientos existentes se conservan.`)) return;
    const { error } = await sb.from("categories").update({ archived: true }).eq("id", initial.id);
    if (error) return setErr(error.message);
    bump();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={initial ? "Editar categoría" : parentId ? "Nueva subcategoría" : "Nueva categoría"}>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-4">
        {!initial && (
          <Segmented className="w-full" value={k} onChange={(v) => { setK(v); setParentId(""); }}
            options={[{ value: "expense", label: "Gasto" }, { value: "income", label: "Ingreso" }]} />
        )}
        <Field label="Nombre"><Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        {!hasChildren && (
          <Field label="Categoría principal">
            <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">— Ninguna (es principal) —</option>
              {roots.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Color">
          <div className="flex flex-wrap gap-2">
            {PALETTE.map((c) => (
              <button type="button" key={c} onClick={() => setColor(c)} aria-label={c}
                className={cx("h-8 w-8 rounded-full ring-offset-2 dark:ring-offset-slate-900", color === c && "ring-2 ring-slate-900 dark:ring-white")}
                style={{ backgroundColor: c }} />
            ))}
          </div>
        </Field>
        <Field label="Ícono">
          <div className="grid grid-cols-8 gap-1.5">
            {Object.entries(CATEGORY_ICONS).map(([key, I]) => (
              <button type="button" key={key} onClick={() => setIcon(key)}
                className={cx("flex h-9 items-center justify-center rounded-lg border", icon === key ? "border-transparent" : "border-slate-200 text-slate-500 dark:border-slate-700")}
                style={icon === key ? { backgroundColor: color + "1f", color } : undefined}>
                <I size={16} />
              </button>
            ))}
          </div>
        </Field>
        {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">{err}</p>}
        <div className="flex gap-2">
          {initial && <Button type="button" variant="secondary" onClick={archive} title="Archivar"><Archive size={16} /></Button>}
          <Button type="submit" className="flex-1">Guardar</Button>
        </div>
      </form>
    </Modal>
  );
}
