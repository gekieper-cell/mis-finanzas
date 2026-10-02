"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Plus, Receipt, Search, Upload } from "lucide-react";
import { useData, useTransactions } from "@/lib/data";
import { totals } from "@/lib/calc";
import { download, parseCSV, parseDateFlexible, toCSV } from "@/lib/csv";
import { fmtDayLong, fmtMoney, fmtMonth, localISO, monthKey, monthRange, parseAmount, shiftMonth } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import { TxRow } from "@/components/TxRow";
import { useQuickAdd } from "@/components/Shell";
import { Button, Card, Empty, Input, Modal, PageHeader, Select, Spinner } from "@/components/ui";

type Period = "month" | "year";

export default function Movimientos() {
  const { accounts, categories, catById, accById } = useData();
  const openTx = useQuickAdd();
  const [period, setPeriod] = useState<Period>("month");
  const [ym, setYm] = useState(monthKey(localISO()));
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [acc, setAcc] = useState("");
  const [cat, setCat] = useState("");
  const [importOpen, setImportOpen] = useState(false);

  const year = ym.slice(0, 4);
  const range = period === "month" ? monthRange(ym) : { from: `${year}-01-01`, to: `${year}-12-31` };
  const { rows, loading } = useTransactions(range.from, range.to);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((t) => {
      if (type && t.type !== type) return false;
      if (acc && t.account_id !== acc && t.transfer_account_id !== acc) return false;
      if (cat) {
        const c = t.category_id ? catById.get(t.category_id) : undefined;
        if (!c || (c.id !== cat && c.parent_id !== cat)) return false;
      }
      if (needle) {
        const c = t.category_id ? catById.get(t.category_id)?.name : "";
        const hay = `${t.note ?? ""} ${c} ${accById.get(t.account_id)?.name ?? ""} ${t.amount}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, q, type, acc, cat, catById, accById]);

  const grouped = useMemo(() => {
    const m = new Map<string, typeof filtered>();
    filtered.forEach((t) => m.set(t.date, [...(m.get(t.date) ?? []), t]));
    return [...m.entries()];
  }, [filtered]);

  const tt = totals(filtered);

  function exportCSV() {
    const TYPE = { expense: "gasto", income: "ingreso", transfer: "transferencia" } as const;
    const data: (string | number)[][] = [["fecha", "tipo", "monto", "categoria", "subcategoria", "cuenta", "cuenta_destino", "nota"]];
    filtered.forEach((t) => {
      const c = t.category_id ? catById.get(t.category_id) : undefined;
      const p = c?.parent_id ? catById.get(c.parent_id) : undefined;
      data.push([
        t.date,
        TYPE[t.type],
        String(t.amount).replace(".", ","),
        p?.name ?? c?.name ?? "",
        p ? c?.name ?? "" : "",
        accById.get(t.account_id)?.name ?? "",
        t.transfer_account_id ? accById.get(t.transfer_account_id)?.name ?? "" : "",
        t.note ?? "",
      ]);
    });
    download(`movimientos_${period === "month" ? ym : year}.csv`, toCSV(data));
  }

  const roots = categories.filter((c) => !c.parent_id && !c.archived);

  return (
    <div>
      <PageHeader
        title="Movimientos"
        subtitle={`${filtered.length} movimientos · Ingresos ${fmtMoney(tt.income)} · Gastos ${fmtMoney(tt.expense)}`}
        action={
          <div className="flex w-full gap-2 sm:w-auto">
            <Button variant="secondary" size="sm" className="flex-1 sm:flex-none" onClick={() => setImportOpen(true)}><Upload size={15} /> Importar</Button>
            <Button variant="secondary" size="sm" className="flex-1 sm:flex-none" onClick={exportCSV} disabled={!filtered.length}><Download size={15} /> CSV</Button>
            <Button size="sm" onClick={() => openTx()} className="hidden sm:inline-flex"><Plus size={15} /> Nuevo</Button>
          </div>
        }
      />

      <Card className="mb-4 p-3">
        <div className="grid grid-cols-2 gap-2 lg:flex lg:flex-wrap lg:items-center">
          <div className="col-span-2 flex items-center gap-2 lg:col-span-1">
            <div className="flex flex-1 items-center justify-between gap-1 rounded-xl border border-slate-200 p-1 dark:border-slate-700 lg:flex-none">
              <button onClick={() => setYm(shiftMonth(ym, period === "month" ? -1 : -12))} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Anterior"><ChevronLeft size={16} /></button>
              <span className="min-w-[128px] text-center text-sm font-medium">{period === "month" ? fmtMonth(ym) : `Año ${year}`}</span>
              <button onClick={() => setYm(shiftMonth(ym, period === "month" ? 1 : 12))} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Siguiente"><ChevronRight size={16} /></button>
            </div>
            <div className="w-24 shrink-0">
              <Select value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="Período">
                <option value="month">Mes</option>
                <option value="year">Año</option>
              </Select>
            </div>
          </div>
          <div className="relative col-span-2 lg:min-w-[220px] lg:flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nota, categoría, monto…" className="pl-9" type="search" />
          </div>
          <Select value={type} onChange={(e) => setType(e.target.value)} className="lg:w-auto" aria-label="Tipo">
            <option value="">Todos</option>
            <option value="expense">Gastos</option>
            <option value="income">Ingresos</option>
            <option value="transfer">Transferencias</option>
          </Select>
          <Select value={acc} onChange={(e) => setAcc(e.target.value)} className="lg:w-auto" aria-label="Cuenta">
            <option value="">Todas las cuentas</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
          <Select value={cat} onChange={(e) => setCat(e.target.value)} className="col-span-2 lg:col-span-1 lg:w-auto" aria-label="Categoría">
            <option value="">Todas las categorías</option>
            {roots.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
      </Card>

      <Card className="p-3">
        {loading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : grouped.length === 0 ? (
          <Empty icon={<Receipt size={22} />} title="No hay movimientos" text="Probá con otro período o filtro." />
        ) : (
          grouped.map(([date, txs]) => {
            const d = totals(txs);
            return (
              <div key={date} className="mb-2">
                <div className="flex items-center justify-between px-2 pb-1 pt-3 text-xs font-medium text-slate-500">
                  <span>{fmtDayLong(date)}</span>
                  <span className="tabular-nums">{d.net !== 0 && (d.net > 0 ? "+" : "−") + fmtMoney(Math.abs(d.net))}</span>
                </div>
                {txs.map((t) => <TxRow key={t.id} tx={t} showDate={false} />)}
              </div>
            );
          })
        )}
      </Card>

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

interface Parsed {
  ok: boolean;
  line: number;
  error?: string;
  payload?: { type: "expense" | "income" | "transfer"; amount: number; date: string; account_id: string; transfer_account_id: string | null; category_id: string | null; note: string | null };
}

function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const sb = supabaseBrowser();
  const { accounts, categories, bump } = useData();
  const [items, setItems] = useState<Parsed[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

  async function onFile(f: File) {
    setDone(null);
    if (f.size > 5 * 1024 * 1024) return setItems([{ ok: false, line: 0, error: "Archivo mayor a 5 MB" }]);
    const rows = parseCSV(await f.text());
    if (rows.length < 2) return setItems([{ ok: false, line: 0, error: "El archivo está vacío" }]);
    const head = rows[0].map(norm);
    const col = (n: string) => head.indexOf(n);
    const iF = col("fecha"), iT = col("tipo"), iM = col("monto"), iC = col("categoria"), iS = col("subcategoria"), iA = col("cuenta"), iD = col("cuenta_destino"), iN = col("nota");
    if (iF < 0 || iM < 0) return setItems([{ ok: false, line: 1, error: "Faltan columnas obligatorias: fecha, monto" }]);

    const accByName = new Map(accounts.map((a) => [norm(a.name), a.id]));
    const out: Parsed[] = rows.slice(1, 5001).map((r, idx) => {
      const line = idx + 2;
      const date = parseDateFlexible(r[iF] ?? "");
      if (!date) return { ok: false, line, error: `Fecha inválida "${r[iF]}"` };
      const rawAmt = parseAmount(r[iM] ?? "");
      if (!Number.isFinite(rawAmt) || rawAmt === 0) return { ok: false, line, error: `Monto inválido "${r[iM]}"` };
      const tRaw = iT >= 0 ? norm(r[iT] ?? "") : "";
      const accName = iA >= 0 ? norm(r[iA] ?? "") : "";
      const account_id = accName ? accByName.get(accName) : accounts[0]?.id;
      if (!account_id) return { ok: false, line, error: `Cuenta "${r[iA]}" no existe` };
      const note = (iN >= 0 ? r[iN]?.trim().slice(0, 200) : "") || null;
      if (tRaw.startsWith("transf")) {
        const dest = iD >= 0 ? accByName.get(norm(r[iD] ?? "")) : undefined;
        if (!dest || dest === account_id) return { ok: false, line, error: "Transferencia sin cuenta_destino válida" };
        return { ok: true, line, payload: { type: "transfer", amount: Math.abs(rawAmt), date, account_id, transfer_account_id: dest, category_id: null, note } };
      }
      const type: "expense" | "income" = tRaw.startsWith("ing") || tRaw === "income" ? "income" : "expense";
      const catName = iC >= 0 ? norm(r[iC] ?? "") : "";
      const subName = iS >= 0 ? norm(r[iS] ?? "") : "";
      const parent = categories.find((c) => !c.parent_id && c.kind === type && norm(c.name) === catName);
      const sub = parent && subName ? categories.find((c) => c.parent_id === parent.id && norm(c.name) === subName) : undefined;
      if (catName && !parent) return { ok: false, line, error: `Categoría "${r[iC]}" no existe` };
      return {
        ok: true,
        line,
        payload: {
          type,
          amount: Math.abs(rawAmt),
          date,
          account_id,
          transfer_account_id: null,
          category_id: sub?.id ?? parent?.id ?? null,
          note,
        },
      };
    });
    setItems(out);
  }

  const good = items.filter((i) => i.ok);
  const bad = items.filter((i) => !i.ok);

  async function run() {
    setBusy(true);
    let n = 0;
    for (let i = 0; i < good.length; i += 500) {
      const { error } = await sb.from("transactions").insert(good.slice(i, i + 500).map((g) => g.payload!));
      if (error) {
        setBusy(false);
        setDone(`Error después de ${n} filas: ${error.message}`);
        return;
      }
      n += Math.min(500, good.length - i);
    }
    setBusy(false);
    setDone(`Importados ${n} movimientos.`);
    setItems([]);
    bump();
  }

  return (
    <Modal open={open} onClose={() => { setItems([]); setDone(null); onClose(); }} title="Importar CSV" wide>
      <div className="space-y-4 text-sm">
        <div className="rounded-xl bg-slate-50 p-3 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <p className="font-medium text-slate-800 dark:text-slate-100">Columnas (la primera fila es el encabezado):</p>
          <code className="mt-1 block text-xs">fecha;tipo;monto;categoria;subcategoria;cuenta;cuenta_destino;nota</code>
          <p className="mt-2 text-xs">
            Obligatorias: <b>fecha</b> (2026-09-15 o 15/09/2026) y <b>monto</b> (12.500 o 12500,50). <b>tipo</b>: gasto / ingreso / transferencia (esta última requiere cuenta_destino).
            Categoría y cuenta deben existir con el mismo nombre. Es el mismo formato que exporta el botón CSV.
          </p>
        </div>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        <Button variant="secondary" onClick={() => fileRef.current?.click()} className="w-full"><Upload size={16} /> Elegir archivo</Button>

        {items.length > 0 && (
          <div>
            <p><b className="text-emerald-600">{good.length}</b> filas válidas · <b className="text-red-600">{bad.length}</b> con errores</p>
            {bad.length > 0 && (
              <ul className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-red-200 p-2 text-xs text-red-700 dark:border-red-900 dark:text-red-300">
                {bad.slice(0, 50).map((b) => <li key={b.line}>Fila {b.line}: {b.error}</li>)}
              </ul>
            )}
            <Button className="mt-3 w-full" onClick={run} disabled={busy || good.length === 0}>
              {busy ? "Importando…" : `Importar ${good.length} movimientos`}
            </Button>
          </div>
        )}
        {done && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{done}</p>}
      </div>
    </Modal>
  );
}
