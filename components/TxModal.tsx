"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, CheckCircle2, ImageUp, Loader2, ScanLine, Trash2, TriangleAlert } from "lucide-react";
import { useData } from "@/lib/data";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtDay, fmtMoney, localISO, parseAmount } from "@/lib/format";
import { merchantKey, scanReceipt, type ScanResult } from "@/lib/scan";
import type { Transaction, TxType } from "@/lib/types";
import { CatIcon } from "./icons";
import { Scanner } from "./Scanner";
import { Button, Field, Input, Modal, Segmented, Select, cx } from "./ui";

const LAST_ACC = "fp:lastAccount";

export function TxModal({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: Transaction | null }) {
  const sb = supabaseBrowser();
  const { accounts, categories, bump } = useData();
  const activeAccounts = accounts.filter((a) => !a.archived);

  const [type, setType] = useState<TxType>("expense");
  const [amount, setAmount] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);
  const [subId, setSubId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [date, setDate] = useState(localISO());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setScan(null);
    setScanStatus(null);
    setScanError(null);
    setDuplicate(null);
    if (initial) {
      const cat = categories.find((c) => c.id === initial.category_id);
      setType(initial.type);
      setAmount(String(initial.amount).replace(".", ","));
      setParentId(cat ? cat.parent_id ?? cat.id : null);
      setSubId(cat?.parent_id ? cat.id : null);
      setAccountId(initial.account_id);
      setToAccountId(initial.transfer_account_id ?? "");
      setDate(initial.date);
      setNote(initial.note ?? "");
    } else {
      let last = "";
      try {
        last = localStorage.getItem(LAST_ACC) ?? "";
      } catch {}
      const def = activeAccounts.find((a) => a.id === last)?.id ?? activeAccounts[0]?.id ?? "";
      setType("expense");
      setAmount("");
      setParentId(null);
      setSubId(null);
      setAccountId(def);
      setToAccountId(activeAccounts.find((a) => a.id !== def)?.id ?? "");
      setDate(localISO());
      setNote("");
    }
    // En celular no abrimos el teclado de entrada: así queda a la vista el botón de escanear
    const touch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
    if (!touch) setTimeout(() => amountRef.current?.focus(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  const parents = useMemo(
    () => categories.filter((c) => c.kind === type && !c.parent_id && !c.archived),
    [categories, type],
  );
  const subs = useMemo(
    () => (parentId ? categories.filter((c) => c.parent_id === parentId && !c.archived) : []),
    [categories, parentId],
  );

  const parsed = parseAmount(amount);

  /** Completa el formulario con lo leído (QR u OCR) */
  const applyResult = useCallback(
    async (r: ScanResult) => {
      setScan(r);
      if (r.isCredit) setType("income");
      else setType((t) => (t === "transfer" ? "expense" : t));
      if (r.amount) setAmount(r.amount.toLocaleString("es-AR", { maximumFractionDigits: 2 }));
      if (r.date) setDate(r.date);

      // Comercio recordado: nombre y categoría de la última vez
      let name = r.merchant ?? "";
      const key = merchantKey(r);
      if (key) {
        const { data: m } = await sb.from("merchants").select("name,category_id").eq("key", key).maybeSingle();
        if (m) {
          name = m.name;
          const cat = categories.find((c) => c.id === m.category_id && !c.archived);
          if (cat) {
            setParentId(cat.parent_id ?? cat.id);
            setSubId(cat.parent_id ? cat.id : null);
          }
        }
      }
      setNote(name);

      // ¿Ya cargada? (mismo número de comprobante, o mismo monto y fecha)
      const num = r.docLabel?.match(/\d{4}-\d{8}$/)?.[0];
      if (num || (r.amount && r.date)) {
        let q = sb.from("transactions").select("date,amount").limit(1);
        q = num ? q.ilike("note", `%${num}%`) : q.eq("amount", r.amount!).eq("date", r.date!);
        const { data: dup } = await q;
        if (dup?.length) setDuplicate(`${fmtDay(dup[0].date)} por ${fmtMoney(Number(dup[0].amount))}`);
      }
    },
    [sb, categories],
  );

  const onQR = useCallback(
    (r: ScanResult) => {
      setScannerOpen(false);
      setScanError(null);
      setDuplicate(null);
      void applyResult(r);
    },
    [applyResult],
  );

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setScannerOpen(false);
    setScanError(null);
    setScan(null);
    setDuplicate(null);
    try {
      await applyResult(await scanReceipt(file, setScanStatus));
    } catch (e) {
      console.error(e);
      setScanError("No pude leer la imagen. Probá con más luz, el ticket entero y sin reflejos.");
    } finally {
      setScanStatus(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function save() {
    setErr(null);
    if (!(parsed > 0)) return setErr("Ingresá un monto válido");
    if (!accountId) return setErr("Elegí una cuenta");
    if (type === "transfer" && (!toAccountId || toAccountId === accountId)) return setErr("Elegí una cuenta destino distinta");
    if (type !== "transfer" && !parentId) return setErr("Elegí una categoría");

    const payload = {
      type,
      amount: parsed,
      date,
      account_id: accountId,
      transfer_account_id: type === "transfer" ? toAccountId : null,
      category_id: type === "transfer" ? null : subId ?? parentId,
      note: [note.trim(), scan?.docLabel].filter(Boolean).join(" · ").slice(0, 200) || null,
    };
    setSaving(true);
    const { error } = initial
      ? await sb.from("transactions").update(payload).eq("id", initial.id)
      : await sb.from("transactions").insert(payload);
    setSaving(false);
    if (error) return setErr(error.message);
    try {
      localStorage.setItem(LAST_ACC, accountId);
    } catch {}
    const key = scan ? merchantKey({ cuit: scan.cuit, merchant: note.trim() || scan.merchant }) : null;
    if (key && type !== "transfer") {
      // Si la tabla aún no existe (migración 002 sin correr) simplemente no recuerda
      await sb.from("merchants").upsert(
        { key, name: (note.trim() || scan?.docLabel || "Comercio").slice(0, 80), category_id: subId ?? parentId, updated_at: new Date().toISOString() },
        { onConflict: "user_id,key" },
      );
    }
    bump();
    onClose();
  }

  async function remove() {
    if (!initial || !confirm("¿Eliminar este movimiento?")) return;
    setSaving(true);
    const { error } = await sb.from("transactions").delete().eq("id", initial.id);
    setSaving(false);
    if (error) return setErr(error.message);
    bump();
    onClose();
  }

  const tone = type === "expense" ? "text-red-600" : type === "income" ? "text-emerald-600" : "text-brand-600";

  return (
    <Modal open={open} onClose={() => (scannerOpen ? setScannerOpen(false) : onClose())} title={initial ? "Editar movimiento" : "Nuevo movimiento"}>
      <Scanner open={scannerOpen} onClose={() => setScannerOpen(false)} onResult={onQR} onPhoto={(f) => void onPhoto(f)} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="space-y-5"
      >
        <Segmented
          className="w-full"
          value={type}
          onChange={(v) => {
            setType(v);
            setParentId(null);
            setSubId(null);
          }}
          options={[
            { value: "expense", label: "Gasto", activeClass: "text-red-600" },
            { value: "income", label: "Ingreso", activeClass: "text-emerald-600" },
            { value: "transfer", label: "Transferencia", activeClass: "text-brand-600" },
          ]}
        />

        {!initial && (
          <div className="space-y-2">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onPhoto(e.target.files?.[0])} />
            {scanStatus ? (
              <div className="flex items-center gap-3 rounded-xl border border-brand-100 bg-brand-50 px-3 py-3 text-sm text-brand-700 dark:border-brand-600/30 dark:bg-brand-600/10 dark:text-brand-100">
                <Loader2 size={18} className="shrink-0 animate-spin" /> {scanStatus}
              </div>
            ) : (
              <div className="flex gap-2">
                <Button type="button" variant="secondary" className="flex-1" onClick={() => setScannerOpen(true)}>
                  <Camera size={17} /> Escanear factura
                </Button>
                <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()} aria-label="Elegir foto de la galería" title="Elegir foto">
                  <ImageUp size={17} />
                </Button>
              </div>
            )}
            {scan && (
              <div
                className={cx(
                  "flex gap-2 rounded-xl px-3 py-2.5 text-xs",
                  scan.source === "qr" || scan.confidence === "alta"
                    ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                    : "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
                )}
              >
                {scan.source === "qr" ? <CheckCircle2 size={16} className="mt-px shrink-0" /> : <ScanLine size={16} className="mt-px shrink-0" />}
                <div>
                  {scan.source === "qr" ? (
                    <p className="font-semibold">Leído del QR fiscal: datos exactos</p>
                  ) : scan.confidence === "alta" ? (
                    <p className="font-semibold">Leído del ticket: el total coincide en varias partes del ticket</p>
                  ) : (
                    <p className="font-semibold">Lectura aproximada del ticket: revisá monto y fecha</p>
                  )}
                  <p>
                    {[scan.docLabel, scan.cuit && `CUIT ${scan.cuit}`, scan.currencyNote, scan.isCredit && "Nota de crédito: se carga como ingreso"]
                      .filter(Boolean)
                      .join(" · ")}
                    {!scan.amount && "No encontré el total: ingresalo a mano."}
                  </p>
                </div>
              </div>
            )}
            {duplicate && (
              <div className="flex gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-200">
                <TriangleAlert size={16} className="mt-px shrink-0" />
                <p><span className="font-semibold">¿Ya la cargaste?</span> Hay un movimiento igual del {duplicate}.</p>
              </div>
            )}
            {scanError && <p className="rounded-xl bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">{scanError}</p>}
          </div>
        )}

        <div className="text-center">
          <div className="flex items-center justify-center gap-1">
            <span className={cx("text-3xl font-semibold", tone)}>$</span>
            <input
              ref={amountRef}
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              style={{ width: `${Math.max(1, amount.length) + 0.6}ch` }}
              className={cx("min-w-[1.6ch] max-w-[80%] bg-transparent text-left text-4xl font-bold tabular-nums outline-none placeholder:text-slate-300", tone)}
            />
          </div>
          <p className="mt-1 h-4 text-xs text-slate-400">{parsed > 0 ? fmtMoney(parsed) : ""}</p>
        </div>

        {type !== "transfer" && (
          <div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {parents.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  onClick={() => {
                    setParentId(c.id);
                    setSubId(null);
                  }}
                  className={cx(
                    "flex flex-col items-center gap-1.5 rounded-xl border p-2 text-center text-xs font-medium transition",
                    parentId === c.id
                      ? "border-transparent font-semibold"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800",
                  )}
                  style={parentId === c.id ? { boxShadow: `0 0 0 2px ${c.color}`, backgroundColor: c.color + "1f", color: c.color } : undefined}
                >
                  <CatIcon icon={c.icon} color={c.color} size={16} box={30} />
                  <span className="line-clamp-2 leading-tight">{c.name}</span>
                </button>
              ))}
            </div>
            {subs.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {subs.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => setSubId(subId === s.id ? null : s.id)}
                    className={cx(
                      "rounded-full border px-3 py-1 text-xs font-medium transition",
                      subId === s.id
                        ? "border-brand-600 bg-brand-600 text-white"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300",
                    )}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label={type === "transfer" ? "Desde" : "Cuenta"}>
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {activeAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          {type === "transfer" ? (
            <Field label="Hacia">
              <Select value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
                {activeAccounts
                  .filter((a) => a.id !== accountId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </Select>
            </Field>
          ) : (
            <Field label="Fecha">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
          )}
        </div>
        {type === "transfer" && (
          <Field label="Fecha">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
        )}
        <Field label={scan ? "Comercio / nota (se recuerda para la próxima)" : "Nota (opcional)"}>
          <Input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Ej: supermercado Coto" />
        </Field>

        {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">{err}</p>}

        <div className="flex gap-2">
          {initial && (
            <Button type="button" variant="secondary" onClick={remove} disabled={saving} aria-label="Eliminar">
              <Trash2 size={16} className="text-red-600" />
            </Button>
          )}
          <Button type="submit" size="lg" className="flex-1" disabled={saving}>
            {saving ? "Guardando…" : initial ? "Guardar cambios" : "Agregar"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
