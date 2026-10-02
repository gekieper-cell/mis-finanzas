import { localISO, parseISO } from "./format";
import { payProjection, type CardStatement, type InstallmentPlan } from "./installments";
import { addMonths } from "./statement";
import type { Account, Recurring, Transaction } from "./types";

/**
 * Proyección de flujo de caja (efectivo + bancos + billeteras):
 *   hoy + ingresos por cobrar − fijos por pagar − pago de tarjeta = disponible para gastos variables
 * Supuestos explícitos (se muestran en la app):
 *  - Los ingresos y gastos fijos salen de Recurrentes (lo que no está cargado ahí, no se proyecta).
 *  - El pago de la tarjeta: saldo del último resumen si vence en el mes; si no, cuotas conocidas
 *    + promedio de consumos con tarjeta de los últimos 3 meses.
 *  - "Ritmo actual": promedio diario de gastos variables (no recurrentes) desde cuentas líquidas, últimos 60 días.
 *  - Las cuentas de ahorro/inversión no se cuentan como disponibles.
 */

export interface MonthProjection {
  month: string; // YYYY-MM
  start: number;
  income: number;
  fixed: number;
  card: number;
  variable: number;
  end: number;
}

export interface Projection {
  liquidNow: number;
  daysLeft: number;
  pendingIncome: number;
  pendingFixed: number;
  pendingCard: number;
  cardIsEstimate: boolean;
  available: number; // para gastos variables hasta fin de mes
  perDay: number;
  pace: number | null; // gasto variable diario habitual
  endAtPace: number | null;
  months: MonthProjection[];
  notes: string[];
}

const LIQUID = new Set(["cash", "bank", "wallet"]);
const r2 = (n: number) => Math.round(n * 100) / 100;

function lastDay(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
}

function nextOcc(d: string, r: Recurring): string {
  const dt = parseISO(d);
  if (r.frequency === "weekly") dt.setDate(dt.getDate() + 7);
  else {
    const months = r.frequency === "yearly" ? 12 : 1;
    const target = new Date(dt.getFullYear(), dt.getMonth() + months, 1);
    const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(r.anchor_day ?? dt.getDate(), last));
    return localISO(target);
  }
  return localISO(dt);
}

/** Ocurrencias de un recurrente entre dos fechas (inclusive) */
function occurrences(r: Recurring, from: string, to: string): string[] {
  const out: string[] = [];
  let d = r.next_date;
  for (let i = 0; i < 400 && d <= to; i++) {
    if (d >= from) out.push(d);
    d = nextOcc(d, r);
  }
  return out;
}

export function project(input: {
  accounts: Account[];
  recurring: Recurring[];
  plans: InstallmentPlan[];
  statements: CardStatement[];
  txs: Transaction[]; // al menos los últimos 90 días
  today?: string;
  horizon?: number; // meses adicionales
}): Projection {
  const today = input.today ?? localISO();
  const ym = today.slice(0, 7);
  const monthEnd = lastDay(ym);
  const notes: string[] = [];

  const liquidAcc = input.accounts.filter((a) => !a.archived && LIQUID.has(a.type));
  const liquidIds = new Set(liquidAcc.map((a) => a.id));
  const cardIds = new Set(input.accounts.filter((a) => !a.archived && a.type === "card").map((a) => a.id));
  const liquidNow = r2(liquidAcc.reduce((s, a) => s + a.balance, 0));
  if (input.accounts.some((a) => !a.archived && a.type === "savings")) notes.push("Las cuentas de ahorro/inversión no se cuentan como disponibles.");

  // Recurrentes que salen de cuentas líquidas (los de tarjeta van dentro del pago de la tarjeta)
  const recs = input.recurring.filter((r) => r.active && !cardIds.has(r.account_id));
  const sumRec = (type: "income" | "expense", from: string, to: string) =>
    r2(recs.filter((r) => r.type === type).reduce((s, r) => s + occurrences(r, from, to).length * r.amount, 0));
  if (!recs.some((r) => r.type === "income")) notes.push("No hay ingresos en Recurrentes (por ejemplo el sueldo): la proyección no suma ingresos futuros.");

  // Consumo habitual con tarjeta que NO son cuotas (promedio mensual de los últimos 3 meses completos)
  const m3 = addMonths(ym, -3);
  const cardTx = input.txs.filter((t) => t.type === "expense" && cardIds.has(t.account_id) && t.date >= `${m3}-01` && t.date < `${ym}-01`);
  const cardVariable = r2(cardTx.filter((t) => !/· cuota \d+\/\d+/.test(t.note ?? "")).reduce((s, t) => s + t.amount, 0) / 3);
  // Débitos automáticos en tarjeta: si ya hay historial de la tarjeta, están dentro del promedio
  // (sumarlos otra vez los contaría dos veces); sin historial, son la mejor estimación disponible.
  const cardFixedRec = cardTx.length
    ? 0
    : r2(input.recurring.filter((r) => r.active && r.type === "expense" && cardIds.has(r.account_id)).reduce((s, r) => s + r.amount, 0));

  // Pago de tarjeta por mes de pago (por cada tarjeta)
  const H = (input.horizon ?? 3) + 1;
  const cuotasBy = new Map([...cardIds].map((id) => [id, payProjection(input.plans.filter((p) => p.account_id === id), input.statements, H, today)]));
  const cardCount = Math.max(1, cardIds.size);
  const paidAfter = (accId: string, since: string) =>
    input.txs.filter((t) => t.type === "transfer" && t.transfer_account_id === accId && t.date >= since).reduce((s, t) => s + t.amount, 0);
  const cardPayment = (month: string, from: string): { amount: number; estimate: boolean } => {
    let amount = 0, estimate = false;
    for (const id of cardIds) {
      const st = input.statements
        .filter((s) => s.account_id === id && s.due_date && s.due_date.slice(0, 7) === month)
        .sort((a, b) => b.closing_date.localeCompare(a.closing_date))[0];
      if (st && st.balance != null) {
        // Resumen conocido: lo que falta pagar de ese resumen (si ya venció, no cuenta)
        if (st.due_date! < from) continue;
        amount += Math.max(0, st.balance - paidAfter(id, st.closing_date));
      } else {
        // Estimado: cuotas ya conocidas + consumo habitual con tarjeta + débitos automáticos
        estimate = true;
        amount += cuotasBy.get(id)?.find((c) => c.month === month)?.amount ?? 0;
        amount += (cardVariable + cardFixedRec) / cardCount;
      }
    }
    return { amount: r2(amount), estimate };
  };

  // Ritmo de gasto variable (cuentas líquidas, sin recurrentes), últimos 60 días
  const d60 = localISO(new Date(parseISO(today).getTime() - 60 * 86400000));
  const variableTx = input.txs.filter((t) => t.type === "expense" && liquidIds.has(t.account_id) && !t.recurring_id && t.date >= d60 && t.date <= today);
  const firstTx = variableTx.map((t) => t.date).sort()[0];
  const spanDays = firstTx ? Math.max(1, Math.round((parseISO(today).getTime() - parseISO(firstTx).getTime()) / 86400000) + 1) : 0;
  const pace = spanDays >= 14 ? r2(variableTx.reduce((s, t) => s + t.amount, 0) / Math.min(60, spanDays)) : null;
  if (pace === null) notes.push("Todavía hay pocos datos para calcular tu ritmo de gasto (hacen falta ~2 semanas de movimientos).");

  // Mes actual
  const daysLeft = Math.round((parseISO(monthEnd).getTime() - parseISO(today).getTime()) / 86400000) + 1;
  const pendingIncome = sumRec("income", today, monthEnd);
  const pendingFixed = sumRec("expense", today, monthEnd);
  const cp = cardPayment(ym, today);
  const available = r2(liquidNow + pendingIncome - pendingFixed - cp.amount);
  const perDay = r2(available / daysLeft);
  const endAtPace = pace !== null ? r2(available - pace * daysLeft) : null;

  // Próximos meses
  const months: MonthProjection[] = [{
    month: ym, start: liquidNow, income: pendingIncome, fixed: pendingFixed, card: cp.amount,
    variable: pace !== null ? r2(pace * daysLeft) : 0, end: endAtPace ?? available,
  }];
  for (let k = 1; k <= (input.horizon ?? 3); k++) {
    const m = addMonths(ym, k);
    const from = `${m}-01`, to = lastDay(m);
    const days = Number(to.slice(8, 10));
    const start = months[k - 1].end;
    const income = sumRec("income", from, to);
    const fixed = sumRec("expense", from, to);
    const card = cardPayment(m, from).amount;
    const variable = pace !== null ? r2(pace * days) : 0;
    months.push({ month: m, start, income, fixed, card, variable, end: r2(start + income - fixed - card - variable) });
  }

  return {
    liquidNow, daysLeft, pendingIncome, pendingFixed, pendingCard: cp.amount, cardIsEstimate: cp.estimate,
    available, perDay, pace, endAtPace, months, notes,
  };
}
