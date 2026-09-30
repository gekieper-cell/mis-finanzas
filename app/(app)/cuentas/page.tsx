"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, ArrowLeftRight, Pencil, Plus, Trash2 } from "lucide-react";
import { useData } from "@/lib/data";
import { fmtMoney, parseAmount } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ACCOUNT_TYPES, type Account, type AccountType } from "@/lib/types";
import { ACCOUNT_ICONS, PALETTE } from "@/components/icons";
import { useQuickAdd } from "@/components/Shell";
import { Button, Card, Field, Input, Modal, PageHeader, Select, cx } from "@/components/ui";

export default function Cuentas() {
  const { accounts } = useData();
  const openTx = useQuickAdd();
  const [edit, setEdit] = useState<Account | null>(null);
  const [open, setOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const active = accounts.filter((a) => !a.archived);
  const archived = accounts.filter((a) => a.archived);
  const assets = active.filter((a) => a.balance >= 0).reduce((s, a) => s + a.balance, 0);
  const debts = active.filter((a) => a.balance < 0).reduce((s, a) => s + a.balance, 0);

  return (
    <div>
      <PageHeader
        title="Cuentas"
        subtitle="Efectivo, bancos, tarjetas y billeteras"
        action={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => openTx()}><ArrowLeftRight size={15} /> Transferir</Button>
            <Button size="sm" onClick={() => { setEdit(null); setOpen(true); }}><Plus size={15} /> Nueva cuenta</Button>
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="bg-gradient-to-br from-brand-600 to-brand-700 p-5 text-white dark:from-brand-600 dark:to-brand-700">
          <p className="text-xs font-medium uppercase tracking-wide text-blue-100">Patrimonio neto</p>
          <p className="mt-2 text-2xl font-bold tabular-nums">{fmtMoney(assets + debts)}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Disponible</p>
          <p className="mt-2 text-2xl font-bold tabular-nums">{fmtMoney(assets)}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Deudas (saldo negativo)</p>
          <p className={cx("mt-2 text-2xl font-bold tabular-nums", debts < 0 && "text-red-600")}>{fmtMoney(debts)}</p>
        </Card>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {active.map((a) => <AccountCard key={a.id} a={a} onEdit={() => { setEdit(a); setOpen(true); }} />)}
      </div>

      {archived.length > 0 && (
        <div className="mt-8">
          <button onClick={() => setShowArchived(!showArchived)} className="text-sm font-medium text-slate-500 hover:text-slate-700">
            {showArchived ? "Ocultar" : "Ver"} archivadas ({archived.length})
          </button>
          {showArchived && (
            <div className="mt-3 grid gap-3 opacity-70 sm:grid-cols-2 lg:grid-cols-3">
              {archived.map((a) => <AccountCard key={a.id} a={a} onEdit={() => { setEdit(a); setOpen(true); }} />)}
            </div>
          )}
        </div>
      )}

      <AccountModal open={open} onClose={() => setOpen(false)} initial={edit} />
    </div>
  );
}

function AccountCard({ a, onEdit }: { a: Account; onEdit: () => void }) {
  const Icon = ACCOUNT_ICONS[a.type];
  return (
    <Card className="group p-5">
      <div className="flex items-start justify-between">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ backgroundColor: a.color + "1f", color: a.color }}>
          <Icon size={20} />
        </span>
        <button onClick={onEdit} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" aria-label="Editar">
          <Pencil size={15} />
        </button>
      </div>
      <p className="mt-4 font-semibold text-slate-900 dark:text-white">{a.name}</p>
      <p className="text-xs text-slate-500">{ACCOUNT_TYPES[a.type]}</p>
      <p className={cx("mt-3 text-2xl font-bold tabular-nums", a.balance < 0 && "text-red-600")}>{fmtMoney(a.balance)}</p>
    </Card>
  );
}

function AccountModal({ open, onClose, initial }: { open: boolean; onClose: () => void; initial: Account | null }) {
  const sb = supabaseBrowser();
  const { bump } = useData();
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("bank");
  const [initialBal, setInitialBal] = useState("0");
  const [color, setColor] = useState(PALETTE[0]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastKey, setLastKey] = useState<string | null>(null);

  // Reinicia el formulario al abrir
  const key = open ? initial?.id ?? "new" : null;
  if (key !== lastKey) {
    setLastKey(key);
    if (open) {
      setName(initial?.name ?? "");
      setType(initial?.type ?? "bank");
      setInitialBal(String(initial?.initial_balance ?? 0).replace(".", ","));
      setColor(initial?.color ?? PALETTE[0]);
      setErr(null);
    }
  }

  async function save() {
    const amt = initialBal.trim() === "" ? 0 : parseAmount(initialBal);
    if (!name.trim()) return setErr("Poné un nombre");
    if (!Number.isFinite(amt)) return setErr("Saldo inicial inválido");
    setBusy(true);
    const payload = { name: name.trim(), type, initial_balance: amt, color };
    const { error } = initial
      ? await sb.from("accounts").update(payload).eq("id", initial.id)
      : await sb.from("accounts").insert(payload);
    setBusy(false);
    if (error) return setErr(error.message);
    bump();
    onClose();
  }

  async function toggleArchive() {
    if (!initial) return;
    setBusy(true);
    const { error } = await sb.from("accounts").update({ archived: !initial.archived }).eq("id", initial.id);
    setBusy(false);
    if (error) return setErr(error.message);
    bump();
    onClose();
  }

  async function remove() {
    if (!initial) return;
    if (!confirm(`¿Eliminar "${initial.name}"? Se borran también TODOS sus movimientos. Si solo querés ocultarla, usá Archivar.`)) return;
    setBusy(true);
    const { error } = await sb.from("accounts").delete().eq("id", initial.id);
    setBusy(false);
    if (error) return setErr(error.message);
    bump();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={initial ? "Editar cuenta" : "Nueva cuenta"}>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-4">
        <Field label="Nombre"><Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Ej: Galicia, Mercado Pago" autoFocus /></Field>
        <Field label="Tipo">
          <Select value={type} onChange={(e) => setType(e.target.value as AccountType)}>
            {Object.entries(ACCOUNT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Saldo inicial" hint="Para tarjetas de crédito, poné la deuda en negativo (ej: -150000).">
          <Input inputMode="decimal" value={initialBal} onChange={(e) => setInitialBal(e.target.value)} />
        </Field>
        <Field label="Color">
          <div className="flex flex-wrap gap-2">
            {PALETTE.map((c) => (
              <button type="button" key={c} onClick={() => setColor(c)} aria-label={c}
                className={cx("h-8 w-8 rounded-full ring-offset-2 dark:ring-offset-slate-900", color === c && "ring-2 ring-slate-900 dark:ring-white")}
                style={{ backgroundColor: c }} />
            ))}
          </div>
        </Field>
        {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">{err}</p>}
        <div className="flex gap-2">
          {initial && (
            <>
              <Button type="button" variant="secondary" onClick={toggleArchive} disabled={busy} title={initial.archived ? "Restaurar" : "Archivar"}>
                {initial.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
              </Button>
              <Button type="button" variant="secondary" onClick={remove} disabled={busy} title="Eliminar"><Trash2 size={16} className="text-red-600" /></Button>
            </>
          )}
          <Button type="submit" className="flex-1" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</Button>
        </div>
      </form>
    </Modal>
  );
}
