"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FileUp, Loader2, Lock, TriangleAlert } from "lucide-react";
import { useData } from "@/lib/data";
import { fmtDay, fmtMoney } from "@/lib/format";
import { fmtYM } from "@/lib/months";
import { supabaseBrowser } from "@/lib/supabase/client";
import { addMonths, checkAgainstBank, parseStatement, type ParsedStatement } from "@/lib/statement";
import { PdfPasswordError, statementText } from "@/lib/statement-reader";
import { Button, Field, Input, Modal, Select, cx } from "./ui";

export function StatementUpload({ open, onClose }: { open: boolean; onClose: () => void }) {
  const sb = supabaseBrowser();
  const { accounts, bump } = useData();
  const cards = accounts.filter((a) => !a.archived && a.type === "card");
  const options = cards.length ? cards : accounts.filter((a) => !a.archived);

  const fileRef = useRef<HTMLInputElement>(null);
  const [accountId, setAccountId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [needPass, setNeedPass] = useState<null | "ask" | "wrong">(null);
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedStatement | null>(null);
  const [method, setMethod] = useState<"pdf" | "ocr" | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFile(null); setParsed(null); setErr(null); setStatus(null); setNeedPass(null); setPassword(""); setMethod(null);
    setAccountId((id) => (options.some((a) => a.id === id) ? id : options[0]?.id ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function read(f: File, pass?: string) {
    setErr(null);
    setParsed(null);
    try {
      const { text, method } = await statementText(f, setStatus, pass);
      const p = parseStatement(text);
      setMethod(method);
      setParsed(p);
      setNeedPass(null);
      setSelected(new Set(p.installments.map((i) => i.key)));
      if (!p.installments.length && !p.closingDate) setErr("No reconocí este archivo como un resumen de tarjeta. ¿Es el resumen completo?");
    } catch (e) {
      if (e instanceof PdfPasswordError) setNeedPass(e.incorrect ? "wrong" : "ask");
      else {
        console.error(e);
        setErr("No pude leer el archivo. Probá con el PDF original del home banking.");
      }
    } finally {
      setStatus(null);
      setPassword("");
    }
  }

  const check = parsed ? checkAgainstBank(parsed) : null;

  async function save() {
    if (!parsed?.closingDate || !accountId) return;
    setSaving(true);
    setErr(null);
    const closingYM = parsed.closingDate.slice(0, 7);
    // Solo se envían los datos leídos: si se re-sube el mismo resumen con una lectura peor,
    // no se pisan valores ya guardados con vacíos.
    const fields: Record<string, unknown> = {
      account_id: accountId,
      closing_date: parsed.closingDate,
      issuer: parsed.issuer,
      card_last4: parsed.cardLast4,
      due_date: parsed.dueDate,
      next_closing: parsed.nextClosing,
      next_due: parsed.nextDue,
      balance: parsed.balance,
      balance_usd: parsed.balanceUsd,
      min_payment: parsed.minPayment,
      bank_projection: parsed.bankProjection.length ? parsed.bankProjection : undefined,
    };
    Object.keys(fields).forEach((k) => fields[k] === undefined && delete fields[k]);
    const st = await sb.from("card_statements").upsert(fields, { onConflict: "user_id,account_id,closing_date" });
    if (st.error) {
      setSaving(false);
      return setErr(st.error.message);
    }
    const rows = parsed.installments
      .filter((i) => selected.has(i.key))
      .map((i) => ({
        account_id: accountId,
        plan_key: i.key,
        description: i.description || "Compra en cuotas",
        voucher: i.voucher ?? null,
        purchase_date: i.date,
        installment_amount: i.amount,
        installments_total: i.total,
        first_closing: `${addMonths(closingYM, -(i.n - 1))}-01`,
        currency: i.currency,
        source: "resumen",
        updated_at: new Date().toISOString(),
      }));
    if (rows.length) {
      // Mismo comprobante/fecha/plan => actualiza en vez de duplicar
      const r = await sb.from("installment_plans").upsert(rows, { onConflict: "user_id,account_id,plan_key" });
      if (r.error) {
        setSaving(false);
        return setErr(r.error.message);
      }
    }
    setSaving(false);
    bump();
    onClose();
  }

  const toggle = (k: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <Modal open={open} onClose={onClose} title="Subir resumen de tarjeta" wide>
      <div className="space-y-4 text-sm">
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf,image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              setFile(f);
              void read(f);
            }
            e.target.value = "";
          }}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tarjeta">
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {options.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field label="Archivo">
            <Button type="button" variant="secondary" className="w-full" onClick={() => fileRef.current?.click()} disabled={!!status}>
              <FileUp size={16} /> {file ? "Elegir otro" : "PDF o captura del resumen"}
            </Button>
          </Field>
        </div>
        <p className="text-xs text-slate-500">
          El archivo se lee en este dispositivo: no se sube ni se guarda. Solo se guardan las fechas, saldos y cuotas.
        </p>

        {status && (
          <div className="flex items-center gap-3 rounded-xl bg-brand-50 px-3 py-3 text-brand-700 dark:bg-brand-600/10 dark:text-brand-100">
            <Loader2 size={18} className="animate-spin" /> {status}
          </div>
        )}

        {needPass && file && (
          <form
            className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700"
            onSubmit={(e) => {
              e.preventDefault();
              void read(file, password);
            }}
          >
            <p className="flex items-center gap-2 font-medium">
              <Lock size={15} /> {needPass === "wrong" ? "Contraseña incorrecta, probá de nuevo" : "El PDF tiene contraseña (suele ser tu DNI)"}
            </p>
            <div className="flex gap-2">
              <Input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
              <Button type="submit" disabled={!password}>Abrir</Button>
            </div>
            <p className="text-xs text-slate-500">La contraseña solo se usa para abrir el archivo en tu navegador; no se guarda.</p>
          </form>
        )}

        {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700 dark:bg-red-950/50 dark:text-red-300">{err}</p>}

        {parsed && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60 sm:grid-cols-4">
              <Info k="Tarjeta" v={[parsed.issuer, parsed.cardLast4 && `•••• ${parsed.cardLast4}`].filter(Boolean).join(" ") || "—"} />
              <Info k="Cierre" v={parsed.closingDate ? fmtDay(parsed.closingDate) : "—"} />
              <Info k="Vence" v={parsed.dueDate ? fmtDay(parsed.dueDate) : "—"} />
              <Info k="Saldo" v={parsed.balance != null ? fmtMoney(parsed.balance) : "—"} />
            </div>

            {check && check.checked > 0 && (
              <div
                className={cx(
                  "flex gap-2 rounded-xl px-3 py-2.5 text-xs",
                  check.ok ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" : "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
                )}
              >
                {check.ok ? <CheckCircle2 size={16} className="shrink-0" /> : <TriangleAlert size={16} className="shrink-0" />}
                <div>
                  {check.ok ? (
                    <p><b>Verificado:</b> las cuotas leídas coinciden con las "Cuotas a vencer" que informa el banco ({check.checked} meses).</p>
                  ) : (
                    <>
                      <p><b>Revisá antes de guardar:</b> lo leído no coincide con lo que informa el banco.</p>
                      <p className="mt-1 opacity-80">{check.diffs.slice(0, 3).join(" · ")}</p>
                      {method === "ocr" && <p className="mt-1">Con el PDF original la lectura es exacta.</p>}
                    </>
                  )}
                </div>
              </div>
            )}
            {parsed.warnings.length > 0 && <p className="text-xs text-slate-500">{parsed.warnings.join(" ")}</p>}

            {parsed.installments.length > 0 && (
              <div>
                <p className="mb-2 font-medium">Compras en cuotas detectadas</p>
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
                  {parsed.installments.map((i) => {
                    const lastYM = parsed.closingDate ? addMonths(parsed.closingDate.slice(0, 7), i.total - i.n + 1) : null;
                    return (
                      <li key={i.key}>
                        <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                          <input type="checkbox" checked={selected.has(i.key)} onChange={() => toggle(i.key)} className="h-4 w-4 accent-brand-600" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{i.description || "Compra"}</p>
                            <p className="text-xs text-slate-500">
                              Cuota {i.n} de {i.total} · compra del {fmtDay(i.date)}
                              {lastYM && i.n < i.total && ` · última se paga en ${fmtYM(lastYM)}`}
                              {i.n === i.total && " · última cuota"}
                            </p>
                          </div>
                          <span className="font-semibold tabular-nums">{i.currency === "USD" ? `US$ ${i.amount}` : fmtMoney(i.amount)}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <Button className="w-full" size="lg" onClick={save} disabled={saving || !parsed.closingDate || !accountId}>
              {saving ? "Guardando…" : `Guardar resumen${selected.size ? ` y ${selected.size} compras en cuotas` : ""}`}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Info({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{k}</p>
      <p className="font-semibold">{v}</p>
    </div>
  );
}
