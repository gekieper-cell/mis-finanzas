"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useData } from "@/lib/data";
import { localISO, parseAmount } from "@/lib/format";
import { cardCalendar, planStatus, type InstallmentPlan } from "@/lib/installments";
import { fmtYM } from "@/lib/months";
import { supabaseBrowser } from "@/lib/supabase/client";
import { addMonths } from "@/lib/statement";
import { Button, Field, Input, Modal, Select } from "./ui";

/** Alta/edición manual de una compra en cuotas */
export function PlanModal({ open, onClose, plan }: { open: boolean; onClose: () => void; plan: InstallmentPlan | null }) {
  const sb = supabaseBrowser();
  const { accounts, statements, bump } = useData();
  const cards = accounts.filter((a) => !a.archived && a.type === "card");
  const options = cards.length ? cards : accounts.filter((a) => !a.archived);

  const [f, setF] = useState({ description: "", amount: "", n: "1", total: "3", account_id: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastKey, setLastKey] = useState<string | null>(null);

  const key = open ? plan?.id ?? "new" : null;
  if (key !== lastKey) {
    setLastKey(key);
    if (open) {
      setErr(null);
      if (plan) {
        const st = planStatus(plan, statements);
        setF({
          description: plan.description,
          amount: String(plan.installment_amount).replace(".", ","),
          n: String(Math.max(1, Math.min(plan.installments_total, st.thisMonthCuota ?? st.billed ?? 1))),
          total: String(plan.installments_total),
          account_id: plan.account_id,
        });
      } else {
        setF({ description: "", amount: "", n: "1", total: "3", account_id: options[0]?.id ?? "" });
      }
    }
  }
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  const n = Number(f.n), total = Number(f.total);
  const valid = n >= 1 && total >= 1 && n <= total && total <= 99;
  const { dueOffset } = cardCalendar(statements, f.account_id);
  const thisMonth = localISO().slice(0, 7);
  const endPay = valid ? addMonths(thisMonth, total - n) : null;

  async function save() {
    const amount = parseAmount(f.amount);
    if (!f.description.trim()) return setErr("Poné una descripción");
    if (!(amount > 0)) return setErr("Monto de cuota inválido");
    if (!valid) return setErr("Revisá el número de cuota y el total");
    if (!f.account_id) return setErr("Elegí la tarjeta");
    // "Este mes pago la cuota n" => la cuota 1 cerró (n-1) meses antes del cierre que se paga este mes
    const firstClosing = `${addMonths(thisMonth, -(n - 1) - dueOffset)}-01`;
    const payload = {
      account_id: f.account_id,
      description: f.description.trim().slice(0, 80),
      installment_amount: amount,
      installments_total: total,
      first_closing: firstClosing,
      updated_at: new Date().toISOString(),
    };
    setBusy(true);
    const { error } = plan
      ? await sb.from("installment_plans").update(payload).eq("id", plan.id)
      : await sb.from("installment_plans").insert({ ...payload, plan_key: `manual|${crypto.randomUUID()}`, source: "manual" });
    setBusy(false);
    if (error) return setErr(error.message);
    bump();
    onClose();
  }

  async function remove() {
    if (!plan || !confirm(`¿Eliminar "${plan.description}"? Si vuelve a aparecer en un resumen, se va a cargar de nuevo.`)) return;
    setBusy(true);
    const { error } = await sb.from("installment_plans").delete().eq("id", plan.id);
    setBusy(false);
    if (error) return setErr(error.message);
    bump();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={plan ? "Editar compra en cuotas" : "Nueva compra en cuotas"}>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-4">
        <Field label="Descripción"><Input value={f.description} maxLength={80} onChange={(e) => set("description", e.target.value)} placeholder="Ej: Heladera Frávega" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Monto de cada cuota"><Input inputMode="decimal" value={f.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0" /></Field>
          <Field label="Tarjeta">
            <Select value={f.account_id} onChange={(e) => set("account_id", e.target.value)}>
              {options.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field label="Este mes pago la cuota"><Input inputMode="numeric" value={f.n} onChange={(e) => set("n", e.target.value.replace(/\D/g, ""))} /></Field>
          <Field label="De un total de"><Input inputMode="numeric" value={f.total} onChange={(e) => set("total", e.target.value.replace(/\D/g, ""))} /></Field>
        </div>
        {endPay && <p className="text-sm text-slate-500">La última cuota se paga en <b>{fmtYM(endPay)}</b>.</p>}
        {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">{err}</p>}
        <div className="flex gap-2">
          {plan && <Button type="button" variant="secondary" onClick={remove} disabled={busy} title="Eliminar"><Trash2 size={16} className="text-red-600" /></Button>}
          <Button type="submit" className="flex-1" disabled={busy}>Guardar</Button>
        </div>
      </form>
    </Modal>
  );
}
