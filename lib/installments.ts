import { localISO } from "./format";
import { addMonths, monthsBetween } from "./statement";

export interface InstallmentPlan {
  id: string;
  account_id: string;
  plan_key: string;
  description: string;
  voucher: string | null;
  purchase_date: string | null;
  installment_amount: number;
  installments_total: number;
  first_closing: string; // YYYY-MM-01
  currency: "ARS" | "USD";
  category_id: string | null;
  source: "resumen" | "manual";
}

export interface CardStatement {
  id: string;
  account_id: string;
  issuer: string | null;
  card_last4: string | null;
  closing_date: string;
  due_date: string | null;
  next_closing: string | null;
  next_due: string | null;
  balance: number | null;
  balance_usd: number | null;
  min_payment: number | null;
  bank_projection: { month: string; amount: number }[];
}

/** Configuración de una tarjeta deducida de su último resumen */
export function cardCalendar(statements: CardStatement[], accountId: string) {
  const last = statements.filter((s) => s.account_id === accountId).sort((a, b) => b.closing_date.localeCompare(a.closing_date))[0];
  const closingDay = last ? Number(last.closing_date.slice(8, 10)) : 25;
  // Cuántos meses después del cierre se paga (casi siempre 1)
  const dueOffset = last?.due_date ? Math.max(0, monthsBetween(last.closing_date.slice(0, 7), last.due_date.slice(0, 7))) : 1;
  return { last, closingDay, dueOffset };
}

/** Mes del último cierre ocurrido a la fecha */
export function lastClosingMonth(statements: CardStatement[], accountId: string, today = localISO()): string {
  const { last, closingDay } = cardCalendar(statements, accountId);
  if (last?.next_closing && today < last.next_closing) return last.closing_date.slice(0, 7);
  const ym = today.slice(0, 7);
  return Number(today.slice(8, 10)) >= closingDay ? ym : addMonths(ym, -1);
}

export interface PlanStatus {
  plan: InstallmentPlan;
  billed: number; // cuotas ya facturadas en resúmenes
  remaining: number; // cuotas que faltan facturar
  remainingAmount: number;
  payMonthOf: (k: number) => string; // mes en que se PAGA la cuota k
  endPayMonth: string; // mes en que se paga la última
  thisMonthCuota: number | null; // nro de cuota que se paga este mes
  toPay: number; // cuotas a pagar desde este mes (inclusive)
  toPayAmount: number;
  finished: boolean;
}

export function planStatus(plan: InstallmentPlan, statements: CardStatement[], today = localISO()): PlanStatus {
  const first = plan.first_closing.slice(0, 7);
  const { dueOffset } = cardCalendar(statements, plan.account_id);
  const lastClose = lastClosingMonth(statements, plan.account_id, today);
  const billed = Math.max(0, Math.min(plan.installments_total, monthsBetween(first, lastClose) + 1));
  const remaining = plan.installments_total - billed;
  const payMonthOf = (k: number) => addMonths(first, k - 1 + dueOffset);
  const thisMonth = today.slice(0, 7);
  const k = monthsBetween(first, thisMonth) - dueOffset + 1;
  const endPayMonth = payMonthOf(plan.installments_total);
  let toPay = 0;
  for (let i = 1; i <= plan.installments_total; i++) if (payMonthOf(i) >= thisMonth) toPay++;
  return {
    plan,
    billed,
    remaining,
    remainingAmount: Math.round(remaining * plan.installment_amount * 100) / 100,
    payMonthOf,
    endPayMonth,
    thisMonthCuota: k >= 1 && k <= plan.installments_total ? k : null,
    toPay,
    toPayAmount: Math.round(toPay * plan.installment_amount * 100) / 100,
    finished: endPayMonth < thisMonth,
  };
}

/** Total a pagar en cuotas por mes de pago, desde este mes en adelante */
export function payProjection(plans: InstallmentPlan[], statements: CardStatement[], months = 12, today = localISO()) {
  const start = today.slice(0, 7);
  const rows = Array.from({ length: months }, (_, i) => ({ month: addMonths(start, i), amount: 0, items: [] as { d: string; k: number; t: number; a: number }[] }));
  for (const p of plans) {
    if (p.currency !== "ARS") continue;
    const st = planStatus(p, statements, today);
    for (let k = 1; k <= p.installments_total; k++) {
      const row = rows.find((r) => r.month === st.payMonthOf(k));
      if (row) {
        row.amount = Math.round((row.amount + p.installment_amount) * 100) / 100;
        row.items.push({ d: p.description, k, t: p.installments_total, a: p.installment_amount });
      }
    }
  }
  return rows;
}
