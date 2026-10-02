/**
 * Lector de resúmenes de tarjeta (probado con Visa Banco Nación).
 * Recibe el TEXTO del resumen (de un PDF con pdf.js, o de una imagen con OCR)
 * y devuelve fechas, saldos, compras en cuotas y la proyección que informa el banco.
 */

export interface StatementInstallment {
  date: string; // fecha de compra YYYY-MM-DD
  voucher?: string; // comprobante
  description: string;
  n: number; // cuota facturada en ESTE resumen
  total: number; // cantidad de cuotas
  amount: number; // importe de la cuota
  currency: "ARS" | "USD";
  key: string; // identifica la compra entre resúmenes
}

export type ChargeKind = "compra" | "cuota" | "impuesto" | "reintegro" | "pago";

/** Cada renglón del resumen con importe (consumos, cuotas, impuestos, pagos) */
export interface StatementCharge {
  date: string; // fecha del renglón
  voucher?: string;
  description: string;
  amount: number; // positivo = cargo; negativo = pago/reintegro
  currency: "ARS" | "USD";
  kind: ChargeKind;
  n?: number;
  total?: number;
  autoDebit?: boolean; // débito automático típico (seguro, streaming, servicios)
  subscription?: boolean; // suscripción (streaming/software)
  key: string; // identifica el renglón entre importaciones
}

export interface ParsedStatement {
  issuer?: string;
  cardLast4?: string;
  closingDate?: string;
  dueDate?: string;
  nextClosing?: string;
  nextDue?: string;
  balance?: number;
  balanceUsd?: number;
  minPayment?: number;
  previousBalance?: number;
  installments: StatementInstallment[];
  charges: StatementCharge[];
  bankProjection: { month: string; amount: number }[]; // mes de CIERRE (YYYY-MM)
  bankAfter?: { from: string; amount: number };
  warnings: string[];
}

const MESES: Record<string, number> = {
  ene: 1, enero: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4, may: 5, mayo: 5, jun: 6, junio: 6,
  jul: 7, julio: 7, ago: 8, agosto: 8, sep: 9, set: 9, sept: 9, septiembre: 9, setiembre: 9,
  oct: 10, octubre: 10, nov: 11, noviembre: 11, dic: 12, diciembre: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");
const yy = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

export function addMonths(ym: string, k: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + k, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
export const monthsBetween = (a: string, b: string) => {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
};

/** "1.234,56" / "1234,56" / "1.234, 56" (OCR) -> número */
function num(s: string): number {
  const t = s.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

/** "24 Sep 26" / "07 Oct 2026" / "22 Oct 26" */
function textDate(s: string): string | undefined {
  const m = s.match(/(\d{1,2})\s*([A-Za-zÁÉÍÓÚáéíóú]{3,10})\.?\s*(\d{2,4})/);
  if (!m) return;
  const mo = MESES[m[2].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")];
  if (!mo) return;
  return `${yy(m[3])}-${pad(mo)}-${pad(Number(m[1]))}`;
}

const AMT = String.raw`-?\d{1,3}(?:\.\d{3})*,\s?\d{2}`;

export function parseStatement(raw: string): ParsedStatement {
  const text = raw.replace(/ /g, " ");
  const lines = text.split(/\r?\n/).map((l) => l.replace(/[ \t]+/g, " ").trim()).filter(Boolean);
  const out: ParsedStatement = { installments: [], charges: [], bankProjection: [], warnings: [] };

  if (/BANCO NACI[OÓ]N|\bBNA\b/i.test(text)) out.issuer = "Banco Nación";
  if (/\bVISA\b/i.test(text)) out.issuer = `Visa${out.issuer ? " " + out.issuer : ""}`;
  else if (/MASTERCARD/i.test(text)) out.issuer = `Mastercard${out.issuer ? " " + out.issuer : ""}`;
  out.cardLast4 = text.match(/TARJETA\s+(\d{4})\s+Total/i)?.[1];

  // --- Fechas del encabezado
  const after = (re: RegExp) => {
    const m = text.match(re);
    return m ? textDate(text.slice(m.index! + m[0].length, m.index! + m[0].length + 30)) : undefined;
  };
  out.closingDate = after(/CIERRE\s*ACTUAL:?/i);
  out.nextClosing = after(/PR[OÓ]XIMO\s*CIERRE:?/i);
  out.nextDue = after(/PR[OÓ]XIMO\s*VTO\.?:?/i);

  // Fila de vencimiento: "07 Oct 26 559.743,20 0,00 59.265,00"
  for (const l of lines) {
    const m = l.match(new RegExp(String.raw`^(\d{1,2}\s*[A-Za-z]{3}\s*\d{2,4})\s+(${AMT})\s+(${AMT})\s+(${AMT})`));
    if (m) {
      out.dueDate = textDate(m[1]);
      out.balance = num(m[2]);
      out.balanceUsd = num(m[3]);
      out.minPayment = num(m[4]);
      break;
    }
  }
  const lineAmount = (re: RegExp) => {
    const l = lines.find((x) => re.test(x));
    const m = l?.match(new RegExp(AMT));
    return m ? num(m[0]) : undefined;
  };
  out.balance ??= lineAmount(/^SALDO ACTUAL/i);
  {
    const m = text.match(new RegExp(String.raw`SALDO\s*ANTERIOR\s*\$?\s*(${AMT})`, "i"));
    if (m) out.previousBalance = num(m[1]);
  }
  out.minPayment ??= lineAmount(/^PAGO M[IÍ]NIMO/i);

  // --- Proyección del banco: "Cuotas a vencer:" + meses + importes
  const ci = lines.findIndex((l) => /CUOTAS A VENCER/i.test(l));
  if (ci >= 0) {
    for (let i = ci + 1; i < Math.min(lines.length, ci + 4); i++) {
      const months = [...lines[i].matchAll(/([A-Za-zÁÉÍÓÚáéíóú]{4,10})\s*\/\s*(\d{2})/g)]
        .map((m) => ({ mo: MESES[m[1].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")], y: yy(m[2]) }))
        .filter((x) => x.mo);
      if (months.length >= 2) {
        const amounts = [...(lines[i + 1] ?? "").matchAll(new RegExp(String.raw`\$\s?(${AMT})`, "g"))].map((m) => num(m[1]));
        months.forEach((m, k) => {
          if (Number.isFinite(amounts[k])) out.bankProjection.push({ month: `${m.y}-${pad(m.mo)}`, amount: amounts[k] });
        });
        break;
      }
    }
  }
  const ap = text.match(new RegExp(String.raw`A partir de\s+([A-Za-zÁÉÍÓÚáéíóú]{4,10})\s*\/\s*(\d{2})\s+\$\s?(${AMT})`, "i"));
  if (ap) {
    const mo = MESES[ap[1].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")];
    if (mo) out.bankAfter = { from: `${yy(ap[2])}-${pad(mo)}`, amount: num(ap[3]) };
  }

  // --- Movimientos: "26.06.26 633224 WWWW.EASY.COM.AR/ PIL C.03/12 33.999,66 0,00"
  const txDates: string[] = [];
  for (const l of lines) {
    const m = l.match(/^(\d{2})[.\/-](\d{2})[.\/-](\d{2,4})\s+(.*)$/);
    if (!m) continue;
    const date = `${yy(m[3])}-${m[2]}-${m[1]}`;
    txDates.push(date);
    const rest = m[4];
    const amts = [...rest.matchAll(new RegExp(AMT, "g"))].map((x) => num(x[0]));
    if (!amts.length) continue;
    // Columnas: PESOS y DÓLAR (en ese orden)
    const [ars, usd] = amts.length >= 2 ? amts.slice(-2) : [amts[0], 0];
    const currency: "ARS" | "USD" = !ars && usd ? "USD" : "ARS";
    const amount = currency === "USD" ? usd : ars;
    if (!amount || !Number.isFinite(amount)) continue;

    const cuota = rest.match(/\b[Cc]\.?\s?(\d{1,2})\s?\/\s?(\d{1,2})\b/) ?? rest.match(/CUOTA\s*(\d{1,2})\s*(?:\/|DE)\s*(\d{1,2})/i);
    // Texto descriptivo: sin el comprobante, la marca de cuota ni los importes
    const firstAmt = rest.search(new RegExp(AMT));
    let head = rest.slice(0, cuota ? cuota.index : firstAmt).replace(/\s*\(.*$/, "").replace(/\s+\d+(?:[.,]\d+)?\s*[%€]?\s*$/, "");
    const vm = head.match(/^(\d{4,})\s+/);
    const voucher = vm?.[1];
    if (vm) head = head.slice(vm[0].length);
    const description = head
      .replace(/^[VW][VWIN]{2,5}\s*\.\s*/i, "") // "WWWW." / OCR "VIVIW ."
      .replace(/\s*\.\s*/g, ".")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);

    const n = cuota ? Number(cuota[1]) : undefined;
    const total = cuota ? Number(cuota[2]) : undefined;
    let kind: ChargeKind = "compra";
    if (/SU PAGO|PAGO EN PESOS|PAGO EN D[OÓ]LARES|PAGO RECIBIDO/i.test(rest)) kind = "pago";
    else if (cuota && n! >= 1 && total! >= n! && total! <= 99) kind = "cuota";
    else if (/IIBB|IVA\s*RG|DB\.?\s*RG|PERCEP|IMP\.?\s|IMPUESTO|SELLOS|COMISI[OÓ]N|INTER[EÉ]S|CARGO|MANTENIM/i.test(rest)) kind = "impuesto";
    else if (amount < 0) kind = "reintegro";

    const autoDebit = kind === "compra" && AUTO_DEBIT.test(description);
    const subscription = kind === "compra" && SUBSCRIPTION.test(description);
    out.charges.push({
      date, voucher, description, amount, currency, kind, n, total, autoDebit, subscription,
      key: [voucher ?? descKey(description), date, amount.toFixed(2), n ?? ""].join("|"),
    });

    if (kind === "cuota" && amount > 0) {
      out.installments.push({
        date, voucher, description, n: n!, total: total!, amount, currency,
        key: `${voucher ?? description.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12)}|${date}|${total}`,
      });
    }
  }

  // --- Cierre: si no se pudo leer, deducirlo (el OCR suele fallar dentro del recuadro)
  if (!out.closingDate) {
    const firstBank = out.bankProjection[0]?.month;
    // El día: cargos de cierre (impuestos/percepciones) llevan la fecha del cierre
    const lastTx = txDates.filter((d) => !out.dueDate || d <= out.dueDate).sort().pop();
    if (firstBank) {
      const ym = addMonths(firstBank, -1);
      const day = lastTx?.startsWith(ym) ? lastTx.slice(8, 10) : "28";
      out.closingDate = `${ym}-${day}`;
      out.warnings.push("La fecha de cierre se dedujo de la proyección de cuotas del banco.");
    } else if (lastTx) {
      out.closingDate = lastTx;
      out.warnings.push("La fecha de cierre se dedujo del último movimiento.");
    }
  }
  if (!out.closingDate) out.warnings.push("No encontré la fecha de cierre del resumen.");
  if (!out.installments.length) out.warnings.push("No encontré compras en cuotas en este resumen.");
  return out;
}

/** Proyección propia por mes de cierre, para comparar con la del banco */
export function projectFromStatement(p: ParsedStatement) {
  const closing = p.closingDate?.slice(0, 7);
  if (!closing) return [];
  const map = new Map<string, number>();
  for (const i of p.installments) {
    if (i.currency !== "ARS") continue;
    for (let k = 1; i.n + k <= i.total; k++) {
      const m = addMonths(closing, k);
      map.set(m, Math.round(((map.get(m) ?? 0) + i.amount) * 100) / 100);
    }
  }
  return [...map.entries()].sort().map(([month, amount]) => ({ month, amount }));
}

/** ¿Coincide lo leído con lo que informa el banco? */
export function checkAgainstBank(p: ParsedStatement): { ok: boolean; checked: number; diffs: string[] } {
  const mine = new Map(projectFromStatement(p).map((x) => [x.month, x.amount]));
  const diffs: string[] = [];
  let checked = 0;
  for (const b of p.bankProjection) {
    checked++;
    const v = mine.get(b.month) ?? 0;
    if (Math.abs(v - b.amount) > 1) diffs.push(`${b.month}: banco ${b.amount} / leído ${v}`);
  }
  if (p.bankAfter) {
    checked++;
    let rest = 0;
    for (const [m, v] of mine) if (m >= p.bankAfter.from) rest += v;
    if (Math.abs(rest - p.bankAfter.amount) > 1) diffs.push(`desde ${p.bankAfter.from}: banco ${p.bankAfter.amount} / leído ${Math.round(rest * 100) / 100}`);
  }
  return { ok: checked > 0 && diffs.length === 0, checked, diffs };
}

/** Débitos automáticos habituales en tarjeta (seguros, streaming, servicios, prepagas, gimnasios) */
const AUTO_DEBIT =
  /(SEGURO|SPOTIFY|NETFLIX|DISNEY|LINKEDIN|YOUTUBE|GOOGLE|APPLE\.COM|ICLOUD|AMAZON|PRIME VIDEO|HBO|\bMAX\b|PARAMOUNT|STAR\s?\+|OPENAI|CHATGPT|ANTHROPIC|CLAUDE|MICROSOFT|OFFICE|ADOBE|DROPBOX|CANVA|DEEZER|CRUNCHYROLL|DEB\.?\s*AUT|D[EÉ]BITO AUTOM|GIMNASIO|MEGATLON|SMART\s?FIT|TELECOM|PERSONAL|MOVISTAR|CLARO|FIBERTEL|\bFLOW\b|DIRECTV|TELECENTRO|EDENOR|EDESUR|METROGAS|NATURGY|AYSA|OSDE|SWISS MEDICAL|GALENO|MEDIFE|OMINT)/i;
const SUBSCRIPTION =
  /(SPOTIFY|NETFLIX|DISNEY|LINKEDIN|YOUTUBE|GOOGLE|APPLE\.COM|ICLOUD|AMAZON|PRIME VIDEO|HBO|\bMAX\b|PARAMOUNT|STAR\s?\+|OPENAI|CHATGPT|ANTHROPIC|CLAUDE|MICROSOFT|OFFICE|ADOBE|DROPBOX|CANVA|DEEZER|CRUNCHYROLL)/i;

/** Clave estable de un comercio a partir del texto del resumen (sin números de póliza/orden) */
export function descKey(d: string): string {
  return d
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^www\.|\.com(\.ar)?.*$/g, "")
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 30);
}

/** Nombre legible para un débito automático: "SEGUROS SUDAME0000…" -> "Seguros Sudame" */
export function prettyName(d: string): string {
  const k = descKey(d.replace(/\*/g, " "));
  const words = [...new Set(k.split(" ").filter((w) => w.length > 1))].slice(0, 3);
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") || d.slice(0, 30);
}

/** ¿Los renglones leídos suman el saldo del resumen? (saldo anterior + cargos + pagos = saldo actual) */
export function checkTotals(p: ParsedStatement): { ok: boolean; diff?: number } | null {
  if (p.balance == null || !p.charges.length) return null;
  const ars = p.charges.filter((c) => c.currency === "ARS");
  const pagos = ars.filter((c) => c.kind === "pago").reduce((s, c) => s + c.amount, 0);
  const net = ars.reduce((s, c) => s + c.amount, 0);
  // Saldo anterior leído; si el OCR no lo pudo leer, se prueba con "pagó el total" (= -pagos)
  const candidates = [p.previousBalance, -pagos].filter((x): x is number => x != null && Number.isFinite(x));
  let best = Infinity;
  for (const prev of candidates) best = Math.min(best, Math.abs(prev + net - p.balance));
  return { ok: best <= 1, diff: Math.round(best * 100) / 100 };
}
