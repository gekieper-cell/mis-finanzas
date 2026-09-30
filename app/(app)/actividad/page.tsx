"use client";

import { useEffect, useState } from "react";
import { History, Pencil, Plus, Trash2 } from "lucide-react";
import { useData } from "@/lib/data";
import { fmtMoney } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Button, Card, Empty, PageHeader, Spinner, cx } from "@/components/ui";

interface Log {
  id: number;
  table_name: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  at: string;
}

const TABLES: Record<string, string> = {
  transactions: "Movimiento", accounts: "Cuenta", categories: "Categoría", budgets: "Presupuesto", recurring: "Recurrente",
};
const FIELDS: Record<string, string> = {
  amount: "monto", date: "fecha", note: "nota", name: "nombre", category_id: "categoría", account_id: "cuenta",
  type: "tipo", archived: "archivado", active: "activo", next_date: "próxima fecha", initial_balance: "saldo inicial",
  color: "color", icon: "ícono", frequency: "frecuencia", auto_post: "automático", is_subscription: "suscripción",
  transfer_account_id: "cuenta destino", parent_id: "categoría principal", anchor_day: "día",
};
const PAGE = 50;
const dt = new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" });

export default function Actividad() {
  const sb = supabaseBrowser();
  const { catById, accById } = useData();
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(true);

  async function load(offset: number) {
    setLoading(true);
    const { data } = await sb.from("audit_log").select("*").order("at", { ascending: false }).range(offset, offset + PAGE - 1);
    const rows = (data ?? []) as Log[];
    setLogs((l) => (offset === 0 ? rows : [...l, ...rows]));
    setMore(rows.length === PAGE);
    setLoading(false);
  }
  useEffect(() => {
    void load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function describe(l: Log): string {
    const d = (l.new_data ?? l.old_data ?? {}) as Record<string, unknown>;
    if (l.table_name === "transactions") {
      const cat = d.category_id ? catById.get(String(d.category_id))?.name : undefined;
      const tipo = d.type === "income" ? "Ingreso" : d.type === "transfer" ? "Transferencia" : "Gasto";
      return `${tipo} ${fmtMoney(Number(d.amount))}${cat ? ` · ${cat}` : ""}${d.note ? ` · ${d.note}` : ""}`;
    }
    if (l.table_name === "budgets") return `${catById.get(String(d.category_id))?.name ?? "Categoría"}: ${fmtMoney(Number(d.amount))}`;
    return String(d.name ?? "");
  }

  function changes(l: Log): string | null {
    if (l.action !== "UPDATE" || !l.old_data || !l.new_data) return null;
    const out: string[] = [];
    for (const k of Object.keys(FIELDS)) {
      const a = l.old_data[k], b = l.new_data[k];
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      const show = (v: unknown) =>
        k === "amount" || k === "initial_balance" ? fmtMoney(Number(v))
        : k.endsWith("category_id") || k === "parent_id" ? catById.get(String(v))?.name ?? "—"
        : k.endsWith("account_id") ? accById.get(String(v))?.name ?? "—"
        : v == null || v === "" ? "—" : String(v);
      out.push(`${FIELDS[k]}: ${show(a)} → ${show(b)}`);
    }
    return out.length ? out.join(" · ") : null;
  }

  return (
    <div>
      <PageHeader title="Actividad" subtitle="Historial de cambios. Se registra automáticamente en la base y no se puede editar ni borrar." />
      <Card className="p-2">
        {logs.length === 0 && !loading ? (
          <Empty icon={<History size={22} />} title="Sin actividad todavía" />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {logs.map((l) => {
              const Icon = l.action === "INSERT" ? Plus : l.action === "DELETE" ? Trash2 : Pencil;
              const ch = changes(l);
              return (
                <li key={l.id} className="flex gap-3 px-3 py-3">
                  <span className={cx("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                    l.action === "INSERT" && "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40",
                    l.action === "UPDATE" && "bg-blue-50 text-blue-600 dark:bg-blue-950/40",
                    l.action === "DELETE" && "bg-red-50 text-red-600 dark:bg-red-950/40")}>
                    <Icon size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-medium">
                        {TABLES[l.table_name] ?? l.table_name} {l.action === "INSERT" ? "creado" : l.action === "DELETE" ? "eliminado" : "modificado"}
                      </span>
                      <span className="text-slate-500"> · {describe(l)}</span>
                    </p>
                    {ch && <p className="mt-0.5 text-xs text-slate-500">{ch}</p>}
                    <p className="mt-0.5 text-xs text-slate-400">{dt.format(new Date(l.at))}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {loading && <div className="flex justify-center py-6"><Spinner /></div>}
        {more && !loading && logs.length > 0 && (
          <div className="p-3 text-center"><Button variant="secondary" size="sm" onClick={() => load(logs.length)}>Cargar más</Button></div>
        )}
      </Card>
    </div>
  );
}
