"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "./supabase/client";
import { setPrivacy } from "./format";
import type { Account, Budget, Category, Recurring, Transaction } from "./types";
import type { CardStatement, InstallmentPlan } from "./installments";

interface DataCtx {
  ready: boolean;
  error: string | null;
  accounts: Account[];
  categories: Category[];
  budgets: Budget[];
  recurring: Recurring[];
  plans: InstallmentPlan[];
  statements: CardStatement[];
  /** false si todavía no se corrió la migración 003 (cuotas) */
  cuotasReady: boolean;
  catById: Map<string, Category>;
  accById: Map<string, Account>;
  /** incrementa en cada cambio: las vistas lo usan para recargar movimientos */
  version: number;
  /** modo privado: montos ocultos */
  hidden: boolean;
  toggleHidden: () => void;
  reload: () => Promise<void>;
  bump: () => void;
}

const Ctx = createContext<DataCtx | null>(null);

const num = <T extends object>(rows: T[] | null, keys: (keyof T)[]): T[] =>
  (rows ?? []).map((r) => {
    const o = { ...r } as Record<string, unknown>;
    keys.forEach((k) => (o[k as string] = Number(o[k as string] ?? 0)));
    return o as T;
  });

export function DataProvider({ children }: { children: React.ReactNode }) {
  const sb = supabaseBrowser();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [recurring, setRecurring] = useState<Recurring[]>([]);
  const [plans, setPlans] = useState<InstallmentPlan[]>([]);
  const [statements, setStatements] = useState<CardStatement[]>([]);
  const [cuotasReady, setCuotasReady] = useState(true);
  const [version, setVersion] = useState(0);
  const [hidden, setHidden] = useState(false);

  // Recordar la preferencia en este dispositivo
  useEffect(() => {
    let v = false;
    try {
      v = localStorage.getItem("fp:privacy") === "1";
    } catch {}
    setPrivacy(v);
    setHidden(v);
  }, []);

  const toggleHidden = useCallback(() => {
    setHidden((h) => {
      const v = !h;
      setPrivacy(v);
      try {
        localStorage.setItem("fp:privacy", v ? "1" : "0");
      } catch {}
      return v;
    });
  }, []);

  const reload = useCallback(async () => {
    const [acc, bal, cat, bud, rec] = await Promise.all([
      sb.from("accounts").select("*").order("created_at"),
      sb.from("account_balances").select("id,balance"),
      sb.from("categories").select("*").order("name"),
      sb.from("budgets").select("id,category_id,amount"),
      sb.from("recurring").select("*").order("next_date"),
    ]);
    const firstErr = [acc, bal, cat, bud, rec].find((r) => r.error)?.error;
    if (firstErr) {
      setError(firstErr.message);
      return;
    }
    const balMap = new Map((bal.data ?? []).map((b) => [b.id as string, Number(b.balance)]));
    setAccounts(
      num(acc.data as Account[], ["initial_balance"]).map((a) => ({ ...a, balance: balMap.get(a.id) ?? a.initial_balance })),
    );
    setCategories((cat.data ?? []) as Category[]);
    setBudgets(num(bud.data as Budget[], ["amount"]));
    setRecurring(num(rec.data as Recurring[], ["amount"]));
    setError(null);

    // Cuotas: tolera que la migración 003 aún no se haya corrido (no rompe el resto de la app)
    const [pl, stm] = await Promise.all([
      sb.from("installment_plans").select("*").order("first_closing"),
      sb.from("card_statements").select("*").order("closing_date", { ascending: false }).limit(24),
    ]);
    if (pl.error || stm.error) {
      setCuotasReady(false);
    } else {
      setCuotasReady(true);
      setPlans(num(pl.data as InstallmentPlan[], ["installment_amount"]));
      setStatements(
        (stm.data as CardStatement[]).map((x) => ({
          ...x,
          balance: x.balance == null ? null : Number(x.balance),
          balance_usd: x.balance_usd == null ? null : Number(x.balance_usd),
          min_payment: x.min_payment == null ? null : Number(x.min_payment),
        })),
      );
    }
  }, [sb]);

  const bump = useCallback(() => {
    setVersion((v) => v + 1);
    void reload();
  }, [reload]);

  useEffect(() => {
    (async () => {
      // Primer login: crea categorías y cuentas por defecto (idempotente)
      const { count } = await sb.from("categories").select("id", { count: "exact", head: true });
      if (count === 0) await sb.rpc("seed_defaults");
      // Registra los recurrentes vencidos
      await sb.rpc("process_recurring");
      await reload();
      setReady(true);
    })();
  }, [sb, reload]);

  const value = useMemo<DataCtx>(
    () => ({
      ready,
      error,
      accounts,
      categories,
      budgets,
      recurring,
      plans,
      statements,
      cuotasReady,
      catById: new Map(categories.map((c) => [c.id, c])),
      accById: new Map(accounts.map((a) => [a.id, a])),
      version,
      hidden,
      toggleHidden,
      reload,
      bump,
    }),
    [ready, error, accounts, categories, budgets, recurring, plans, statements, cuotasReady, version, hidden, toggleHidden, reload, bump],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useData fuera de DataProvider");
  return ctx;
}

// Caché en memoria de movimientos por rango (dura mientras la app está abierta)
const txCache: { from: string; to: string; version: number; rows: Transaction[] }[] = [];
function fromCache(from: string, to: string, version: number): Transaction[] | null {
  // Sirve cualquier rango ya traído que CUBRA el pedido (p. ej. el Resumen trae 6 meses)
  const hit = txCache.find((c) => c.version === version && c.from <= from && c.to >= to);
  return hit ? hit.rows.filter((t) => t.date >= from && t.date <= to) : null;
}

/** Trae movimientos entre dos fechas (inclusive), paginando de a 1000 */
export function useTransactions(from: string, to: string) {
  const sb = supabaseBrowser();
  const { version } = useData();
  const [rows, setRows] = useState<Transaction[]>(() => fromCache(from, to, version) ?? []);
  const [loading, setLoading] = useState(() => !fromCache(from, to, version));
  const shownRange = useRef(`${from}|${to}`);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = fromCache(from, to, version);
      if (cached) {
        setRows(cached);
        setLoading(false); // se muestra ya; abajo se actualiza de fondo
      } else if (shownRange.current !== `${from}|${to}`) {
        setLoading(true); // otro período: no mostrar datos de otro mes
      } // mismo período tras guardar algo: se siguen viendo los datos mientras actualiza
      shownRange.current = `${from}|${to}`;
      const all: Transaction[] = [];
      for (let page = 0; page < 50; page++) {
        const { data, error } = await sb
          .from("transactions")
          .select("*")
          .gte("date", from)
          .lte("date", to)
          .order("date", { ascending: false })
          .order("created_at", { ascending: false })
          .range(page * 1000, page * 1000 + 999);
        if (error || !data) break;
        all.push(...num(data as Transaction[], ["amount"]));
        if (data.length < 1000) break;
      }
      if (!cancelled) {
        setRows(all);
        setLoading(false);
      }
      txCache.unshift({ from, to, version, rows: all });
      txCache.splice(12); // tope de memoria
    })();
    return () => {
      cancelled = true;
    };
  }, [sb, from, to, version]);

  return { rows, loading };
}

/** Id de la categoría raíz (para agrupar subcategorías bajo su padre) */
export function rootOf(catId: string | null, catById: Map<string, Category>): string | null {
  if (!catId) return null;
  const c = catById.get(catId);
  return c?.parent_id ?? catId;
}
