"use client";

import { ArrowLeftRight, Repeat } from "lucide-react";
import { useData } from "@/lib/data";
import { fmtDay, fmtMoney } from "@/lib/format";
import type { Transaction } from "@/lib/types";
import { CatIcon } from "./icons";
import { useQuickAdd } from "./Shell";
import { cx } from "./ui";

export function TxRow({ tx, showDate = true }: { tx: Transaction; showDate?: boolean }) {
  const { catById, accById } = useData();
  const openTx = useQuickAdd();
  const cat = tx.category_id ? catById.get(tx.category_id) : undefined;
  const parent = cat?.parent_id ? catById.get(cat.parent_id) : undefined;
  const acc = accById.get(tx.account_id);
  const to = tx.transfer_account_id ? accById.get(tx.transfer_account_id) : undefined;

  const title = tx.type === "transfer" ? "Transferencia" : tx.note || cat?.name || "Sin categoría";
  const sub =
    tx.type === "transfer"
      ? `${acc?.name ?? "?"} → ${to?.name ?? "?"}`
      : [parent ? `${parent.name} · ${cat?.name}` : cat?.name, acc?.name].filter(Boolean).join(" · ");

  return (
    <button
      onClick={() => openTx(tx)}
      className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
    >
      {tx.type === "transfer" ? (
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800">
          <ArrowLeftRight size={16} />
        </span>
      ) : (
        <CatIcon icon={cat?.icon ?? "tag"} color={cat?.color ?? "#64748b"} />
      )}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm font-medium text-slate-900 dark:text-slate-100">
          {title}
          {tx.recurring_id && <Repeat size={12} className="shrink-0 text-slate-400" aria-label="Recurrente" />}
        </p>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">{sub}</p>
      </div>
      <div className="text-right">
        <p
          className={cx(
            "text-sm font-semibold tabular-nums",
            tx.type === "expense" && "text-slate-900 dark:text-slate-100",
            tx.type === "income" && "text-emerald-600 dark:text-emerald-400",
            tx.type === "transfer" && "text-slate-500",
          )}
        >
          {tx.type === "expense" ? "−" : tx.type === "income" ? "+" : ""}
          {fmtMoney(tx.amount)}
        </p>
        {showDate && <p className="text-xs text-slate-400">{fmtDay(tx.date)}</p>}
      </div>
    </button>
  );
}
