"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "./supabase/client";
import type { Account, Budget, Category, Recurring, Transaction } from "./types";

interface DataCtx {
  ready: boolean;
  error: string | null;
  accounts: Account[];
  categories: Category[];
  budgets: Budget[];
  recurring: Recurring[];
  catById: Map<string, Category>;
  accById: Map<string, Account>;
  /** incrementa en cada cambio: las vistas lo usan para recargar movimientos */
  version: number;
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
  const [version, setVersion] = useState(0);

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
      catById: new Map(categories.map((c) => [c.id, c])),
      accById: new Map(accounts.map((a) => [a.id, a])),
      version,
      reload,
      bump,
    }),
    [ready, error, accounts, categories, budgets, recurring, version, reload, bump],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useData fuera de DataProvider");
  return ctx;
}

/** Trae movimientos entre dos fechas (inclusive), paginando de a 1000 */
export function useTransactions(from: string, to: string) {
  const sb = supabaseBrowser();
  const { version } = useData();
  const [rows, setRows] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
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
