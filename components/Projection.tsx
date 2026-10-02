"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Gauge, Info } from "lucide-react";
import { useData } from "@/lib/data";
import { fmtCompact, fmtDayLong, fmtMoney, localISO, monthRange } from "@/lib/format";
import { fmtYM } from "@/lib/months";
import { project } from "@/lib/projection";
import type { Transaction } from "@/lib/types";
import { Card, cx } from "./ui";

export function ProjectionCard({ txs }: { txs: Transaction[] }) {
  const { accounts, recurring, plans, statements } = useData();
  const [open, setOpen] = useState(false);
  const p = useMemo(() => project({ accounts, recurring, plans, statements, txs }), [accounts, recurring, plans, statements, txs]);
  const end = monthRange(localISO().slice(0, 7)).to;
  const short = p.available < 0;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 p-5">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            <Gauge size={15} /> Hasta fin de mes
          </p>
          {short ? (
            <>
              <p className="mt-2 text-2xl font-bold tabular-nums text-red-600">No llegás: faltan {fmtMoney(-p.available)}</p>
              <p className="mt-1 text-sm text-slate-500">Con lo que tenés y lo que te falta cobrar no alcanza para los fijos y la tarjeta.</p>
            </>
          ) : (
            <>
              <p className="mt-2 text-2xl font-bold tabular-nums sm:text-3xl">
                {fmtMoney(Math.floor(p.perDay))} <span className="text-base font-medium text-slate-500">por día</span>
              </p>
              <p className="mt-1 text-sm text-slate-500">
                para gastos del día a día hasta el {fmtDayLong(end).replace(/^[^,]*,\s*/, "")} ({p.daysLeft} días)
              </p>
            </>
          )}
        </div>
        {p.pace !== null && !short && (
          <div className={cx("rounded-xl px-3 py-2 text-sm", (p.endAtPace ?? 0) >= 0 ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" : "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200")}>
            A tu ritmo ({fmtMoney(Math.round(p.pace))}/día) {(p.endAtPace ?? 0) >= 0 ? "terminás el mes con " : "te faltarían "}
            <b className="tabular-nums">{fmtMoney(Math.abs(p.endAtPace ?? 0))}</b>
          </div>
        )}
      </div>

      {/* Próximos meses: saldo estimado a fin de cada mes */}
      <div className="grid grid-cols-2 gap-px border-t border-slate-100 bg-slate-100 dark:border-slate-800 dark:bg-slate-800 sm:grid-cols-4">
        {p.months.map((m) => (
          <div key={m.month} className="bg-white px-4 py-3 dark:bg-slate-900">
            <p className="text-xs text-slate-500">Fin de {fmtYM(m.month)}</p>
            <p className={cx("mt-0.5 font-semibold tabular-nums", m.end < 0 && "text-red-600")}>{fmtCompact(m.end)}</p>
            <p className="text-[11px] text-slate-400">tarjeta {fmtCompact(m.card)}</p>
          </div>
        ))}
      </div>

      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between border-t border-slate-100 px-5 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800/50">
        ¿Cómo se calcula? <ChevronDown size={16} className={cx("transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-slate-100 px-5 py-4 text-sm dark:border-slate-800">
          <Line k="Hoy tenés (banco, efectivo, billeteras)" v={p.liquidNow} />
          <Line k="+ Te falta cobrar este mes (Recurrentes)" v={p.pendingIncome} />
          <Line k="− Gastos fijos que faltan (Recurrentes)" v={-p.pendingFixed} />
          <Line k={`− Tarjeta ${p.cardIsEstimate ? "(estimado: cuotas + consumo habitual)" : "(saldo del resumen)"}`} v={-p.pendingCard} />
          <div className="border-t border-slate-200 pt-1.5 dark:border-slate-700">
            <Line k="= Disponible para el día a día" v={p.available} strong />
          </div>
          <p className="pt-2 text-xs text-slate-500">
            Próximos meses: sueldo y fijos de Recurrentes, tarjeta = cuotas conocidas + tu consumo habitual con tarjeta (promedio 3 meses), y gasto diario a tu ritmo actual.
          </p>
          {p.notes.map((n) => (
            <p key={n} className="flex gap-1.5 text-xs text-amber-700 dark:text-amber-300"><Info size={13} className="mt-0.5 shrink-0" /> {n}</p>
          ))}
        </div>
      )}
    </Card>
  );
}

function Line({ k, v, strong }: { k: string; v: number; strong?: boolean }) {
  return (
    <div className={cx("flex justify-between gap-3", strong && "font-semibold")}>
      <span className={strong ? "" : "text-slate-600 dark:text-slate-300"}>{k}</span>
      <span className={cx("shrink-0 tabular-nums", v < 0 && !strong && "text-slate-500")}>{fmtMoney(v)}</span>
    </div>
  );
}
