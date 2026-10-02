"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, FileUp, Loader2, Lock, Repeat, TriangleAlert } from "lucide-react";
import { useData } from "@/lib/data";
import { fmtDay, fmtMoney } from "@/lib/format";
import { fmtYM } from "@/lib/months";
import { supabaseBrowser } from "@/lib/supabase/client";
import { addMonths, checkAgainstBank, checkTotals, descKey, parseStatement, prettyName, type ParsedStatement, type StatementCharge } from "@/lib/statement";
import { guessCategory } from "@/lib/categorize";
import { PdfPasswordError, statementText } from "@/lib/statement-reader";
import { Button, Field, Input, Modal, Select, cx } from "./ui";

export function StatementUpload({ open, onClose }: { open: boolean; onClose: () => void }) {
  const sb = supabaseBrowser();
  const { accounts, categories, recurring, bump } = useData();
  const cards = accounts.filter((a) => !a.archived && a.type === "card");
  const options = cards.length ? cards : accounts.filter((a) => !a.archived);
  const payAccounts = accounts.filter((a) => !a.archived && a.type !== "card");
  const expenseCats = categories.filter((c) => c.kind === "expense" && !c.archived);
  const roots = expenseCats.filter((c) => !c.parent_id);

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
  // Consumos: incluir y categoría por renglón
  const [chg, setChg] = useState<Record<string, { on: boolean; cat: string }>>({});
  // Débitos automáticos a pasar a Recurrentes (nombre editable)
  const [deb, setDeb] = useState<Record<string, { on: boolean; name: string }>>({});
  const [payOn, setPayOn] = useState(true);
  const [payFrom, setPayFrom] = useState("");
  const [showCharges, setShowCharges] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFile(null); setParsed(null); setErr(null); setStatus(null); setNeedPass(null); setPassword(""); setMethod(null);
    setChg({}); setDeb({}); setPayOn(true); setShowCharges(false);
    setPayFrom((id) => (payAccounts.some((a) => a.id === id) ? id : payAccounts.find((a) => a.type === "bank")?.id ?? payAccounts[0]?.id ?? ""));
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

      // Categoría por consumo: primero lo aprendido de cada comercio, después reglas
      const imp = p.charges.filter(importable);
      const keys = [...new Set(imp.map((c) => descKey(c.description)).filter(Boolean))];
      const learned = new Map<string, string | null>();
      if (keys.length) {
        const { data } = await sb.from("merchants").select("key,category_id").in("key", keys);
        (data ?? []).forEach((m) => learned.set(m.key as string, m.category_id as string | null));
      }
      const c: Record<string, { on: boolean; cat: string }> = {};
      for (const x of imp) {
        const k = descKey(x.description);
        const cat = learned.get(k) ?? guessCategory(x.description, categories) ?? "";
        c[x.key] = { on: true, cat: x.kind === "reintegro" ? "" : cat };
      }
      setChg(c);
      // Débitos automáticos que todavía no están en Recurrentes
      const have = recurring.map((r) => descKey(r.name));
      const d: Record<string, { on: boolean; name: string }> = {};
      for (const x of p.charges.filter((x) => x.autoDebit && x.currency === "ARS")) {
        const name = prettyName(x.description);
        const exists = have.some((h) => h && (h.includes(descKey(name)) || descKey(name).includes(h)));
        d[x.key] = { on: !exists, name: exists ? `${name} (ya está en Recurrentes)` : name };
      }
      setDeb(d);
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
  const totals = parsed ? checkTotals(parsed) : null;
  const imp = parsed ? parsed.charges.filter(importable) : [];
  const nOn = imp.filter((c) => chg[c.key]?.on).length;
  const sumOn = imp.filter((c) => chg[c.key]?.on).reduce((s, c) => s + c.amount, 0);
  const pago = parsed?.charges.find((c) => c.kind === "pago" && c.currency === "ARS");
  const debits = parsed ? parsed.charges.filter((c) => c.autoDebit && c.currency === "ARS") : [];
  const usd = parsed ? parsed.charges.filter((c) => c.currency === "USD" && c.kind !== "pago") : [];

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
    // Consumos como movimientos de la tarjeta (sin duplicar: import_key único)
    const otros = categories.find((c) => c.kind === "income" && /otros/i.test(c.name))?.id ?? null;
    const txs: Record<string, unknown>[] = [];
    for (const c of parsed.charges.filter(importable)) {
      const sel = chg[c.key];
      if (!sel?.on) continue;
      const base = { account_id: accountId, import_key: `${accountId}|${c.key}`.slice(0, 200) };
      if (c.kind === "reintegro") {
        txs.push({ ...base, type: "income", amount: Math.abs(c.amount), date: c.date, category_id: otros, note: `Reintegro · ${c.description}`.slice(0, 200) });
      } else if (c.kind === "cuota") {
        // La cuota es gasto del mes de ESTE resumen (no de la fecha de compra original)
        txs.push({ ...base, type: "expense", amount: c.amount, date: parsed.closingDate, category_id: sel.cat || null, note: `${c.description} · cuota ${c.n}/${c.total}`.slice(0, 200) });
      } else {
        txs.push({ ...base, type: "expense", amount: c.amount, date: c.date, category_id: sel.cat || null, note: c.description.slice(0, 200) });
      }
    }
    const pago = parsed.charges.find((c) => c.kind === "pago" && c.currency === "ARS");
    if (pago && payOn && payFrom && payFrom !== accountId) {
      txs.push({
        type: "transfer", amount: Math.abs(pago.amount), date: pago.date, account_id: payFrom, transfer_account_id: accountId,
        note: "Pago del resumen de la tarjeta", import_key: `${accountId}|${pago.key}`.slice(0, 200),
      });
    }
    if (txs.length) {
      const r = await sb.from("transactions").upsert(txs, { onConflict: "user_id,import_key", ignoreDuplicates: true });
      if (r.error) {
        setSaving(false);
        return setErr(r.error.message);
      }
    }

    // Aprender la categoría de cada comercio para el próximo resumen
    const learn = new Map<string, { key: string; name: string; category_id: string | null; updated_at: string }>();
    for (const c of parsed.charges.filter(importable)) {
      const sel = chg[c.key];
      const k = descKey(c.description);
      if (sel?.on && sel.cat && k && c.kind !== "reintegro")
        learn.set(k, { key: k, name: (deb[c.key]?.name ?? prettyName(c.description)).replace(/ \(ya está.*$/, "").slice(0, 80), category_id: sel.cat, updated_at: new Date().toISOString() });
    }
    if (learn.size) await sb.from("merchants").upsert([...learn.values()], { onConflict: "user_id,key" });

    // Débitos automáticos -> Recurrentes (se cobran en la tarjeta: no se registran solos, llegan con el resumen)
    const next = parsed.nextClosing ?? `${addMonths(closingYM, 1)}-${parsed.closingDate.slice(8, 10)}`;
    const recs = parsed.charges
      .filter((c) => c.autoDebit && deb[c.key]?.on && !/\(ya está/.test(deb[c.key].name))
      .map((c) => ({
        name: deb[c.key].name.trim().slice(0, 80) || prettyName(c.description),
        type: "expense",
        amount: c.amount,
        account_id: accountId,
        category_id: chg[c.key]?.cat || null,
        frequency: "monthly",
        anchor_day: Number(next.slice(8, 10)),
        next_date: next,
        is_subscription: !!c.subscription,
        auto_post: false,
      }));
    if (recs.length) {
      const r = await sb.from("recurring").insert(recs);
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
            {totals && (
              <div className={cx("flex gap-2 rounded-xl px-3 py-2.5 text-xs", totals.ok ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" : "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200")}>
                {totals.ok ? <CheckCircle2 size={16} className="shrink-0" /> : <TriangleAlert size={16} className="shrink-0" />}
                <p>
                  {totals.ok
                    ? <><b>Completo:</b> los {parsed.charges.length} renglones leídos suman exactamente el saldo del resumen.</>
                    : <><b>Faltan renglones:</b> lo leído no suma el saldo (diferencia {fmtMoney(totals.diff ?? 0)}). {method === "ocr" ? "Con el PDF original la lectura es completa." : ""}</>}
                </p>
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

            {imp.length > 0 && (
              <div>
                <button type="button" onClick={() => setShowCharges(!showCharges)} className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-left dark:border-slate-700">
                  <span>
                    <span className="font-medium">Consumos del resumen</span>
                    <span className="block text-xs text-slate-500">Se cargan como gastos de la tarjeta: {nOn} de {imp.length} · {fmtMoney(sumOn)}</span>
                  </span>
                  <ChevronDown size={18} className={cx("shrink-0 transition", showCharges && "rotate-180")} />
                </button>
                {showCharges && (
                  <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
                    {imp.map((c) => (
                      <li key={c.key} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
                        <input type="checkbox" checked={!!chg[c.key]?.on} onChange={() => setChg((x) => ({ ...x, [c.key]: { ...x[c.key], on: !x[c.key]?.on } }))} className="h-4 w-4 accent-brand-600" aria-label="Incluir" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{c.kind === "cuota" ? `${c.description} · cuota ${c.n}/${c.total}` : c.description}</p>
                          <p className="text-xs text-slate-500">{fmtDay(c.kind === "cuota" ? parsed.closingDate! : c.date)} · {KIND[c.kind]}</p>
                        </div>
                        <span className={cx("font-semibold tabular-nums", c.amount < 0 && "text-emerald-600")}>{fmtMoney(c.amount)}</span>
                        {c.kind !== "reintegro" && (
                          <select
                            value={chg[c.key]?.cat ?? ""}
                            onChange={(e) => setChg((x) => ({ ...x, [c.key]: { ...x[c.key], cat: e.target.value } }))}
                            className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-base dark:border-slate-700 dark:bg-slate-800 sm:w-48 sm:text-xs"
                            aria-label="Categoría"
                          >
                            <option value="">Sin categoría</option>
                            {roots.map((r) => (
                              <optgroup key={r.id} label={r.name}>
                                <option value={r.id}>{r.name}</option>
                                {expenseCats.filter((s) => s.parent_id === r.id).map((s) => <option key={s.id} value={s.id}>↳ {s.name}</option>)}
                              </optgroup>
                            ))}
                          </select>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-1.5 text-xs text-slate-500">Si ya cargaste a mano algún consumo de la tarjeta, destildalo. Volver a subir el mismo resumen no duplica nada.</p>
                {usd.length > 0 && <p className="mt-1 text-xs text-slate-500">{usd.length} consumos en dólares no se importan (la app trabaja en pesos).</p>}
              </div>
            )}

            {debits.length > 0 && (
              <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <p className="flex items-center gap-2 font-medium"><Repeat size={15} /> Débitos automáticos detectados</p>
                <p className="mb-2 text-xs text-slate-500">Se cobran todos los meses en la tarjeta. Agregalos a Recurrentes para tenerlos en cuenta en la proyección. Podés cambiarles el nombre (ej.: "Seguro moto").</p>
                <ul className="space-y-2">
                  {debits.map((c) => (
                    <li key={c.key} className="flex items-center gap-2">
                      <input type="checkbox" checked={!!deb[c.key]?.on} disabled={/\(ya está/.test(deb[c.key]?.name ?? "")}
                        onChange={() => setDeb((x) => ({ ...x, [c.key]: { ...x[c.key], on: !x[c.key]?.on } }))} className="h-4 w-4 accent-brand-600" aria-label="Agregar a Recurrentes" />
                      <Input value={deb[c.key]?.name ?? ""} maxLength={80} disabled={/\(ya está/.test(deb[c.key]?.name ?? "")}
                        onChange={(e) => setDeb((x) => ({ ...x, [c.key]: { ...x[c.key], name: e.target.value } }))} className="h-9 flex-1" aria-label="Nombre" />
                      <span className="w-24 shrink-0 text-right font-semibold tabular-nums">{fmtMoney(c.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {pago && payAccounts.length > 0 && (
              <label className="flex cursor-pointer flex-wrap items-center gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <input type="checkbox" checked={payOn} onChange={() => setPayOn(!payOn)} className="h-4 w-4 accent-brand-600" />
                <span className="flex-1">
                  Registrar el pago de {fmtMoney(Math.abs(pago.amount))} ({fmtDay(pago.date)}) como transferencia desde
                </span>
                <select value={payFrom} onChange={(e) => setPayFrom(e.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-base dark:border-slate-700 dark:bg-slate-800 sm:text-sm">
                  {payAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
            )}

            <Button className="w-full" size="lg" onClick={save} disabled={saving || !parsed.closingDate || !accountId}>
              {saving ? "Guardando…" : `Guardar resumen${nOn ? ` · ${nOn} consumos` : ""}${selected.size ? ` · ${selected.size} en cuotas` : ""}`}
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

const KIND: Record<StatementCharge["kind"], string> = {
  compra: "compra", cuota: "cuota del mes", impuesto: "impuesto / cargo", reintegro: "reintegro", pago: "pago",
};

/** Renglones que se cargan como movimientos de la tarjeta */
function importable(c: StatementCharge) {
  return c.currency === "ARS" && c.kind !== "pago";
}
