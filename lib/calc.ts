import type { Budget, Category, Recurring, Transaction } from "./types";

export function totals(rows: Transaction[]) {
  let income = 0,
    expense = 0;
  for (const t of rows) {
    if (t.type === "income") income += t.amount;
    else if (t.type === "expense") expense += t.amount;
  }
  return { income, expense, net: income - expense };
}

/** Gasto por categoría raíz (las subcategorías suman a su padre) */
export function spendByRoot(rows: Transaction[], catById: Map<string, Category>, kind: "expense" | "income" = "expense") {
  const m = new Map<string, number>();
  for (const t of rows) {
    if (t.type !== kind) continue;
    const c = t.category_id ? catById.get(t.category_id) : undefined;
    const root = c ? c.parent_id ?? c.id : "none";
    m.set(root, (m.get(root) ?? 0) + t.amount);
  }
  return m;
}

export interface BudgetLine {
  category: Category;
  budget: number;
  spent: number;
  pct: number;
}

export function budgetLines(rows: Transaction[], categories: Category[], budgets: Budget[], catById: Map<string, Category>): BudgetLine[] {
  const spent = spendByRoot(rows, catById);
  const bmap = new Map(budgets.map((b) => [b.category_id, b.amount]));
  return categories
    .filter((c) => c.kind === "expense" && !c.parent_id && !c.archived)
    .map((c) => {
      const budget = bmap.get(c.id) ?? 0;
      const s = spent.get(c.id) ?? 0;
      return { category: c, budget, spent: s, pct: budget > 0 ? (s / budget) * 100 : 0 };
    })
    .sort((a, b) => b.pct - a.pct || b.spent - a.spent);
}

/** Costo mensual equivalente de un recurrente */
export function monthlyCost(r: Recurring) {
  return r.frequency === "weekly" ? (r.amount * 52) / 12 : r.frequency === "yearly" ? r.amount / 12 : r.amount;
}
