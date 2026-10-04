"use client";

import { localISO, parseAmount } from "./format";

/**
 * Lectura de facturas/tickets desde una foto, 100% en el navegador.
 * 1) QR fiscal de AFIP/ARCA (RG 4892): datos exactos (importe, fecha, CUIT, comprobante).
 * 2) Respaldo: OCR (Tesseract, español) para tickets sin QR: total, fecha, CUIT y comercio aproximados.
 * La imagen nunca sale del dispositivo.
 */

export interface ScanResult {
  source: "qr" | "ocr";
  confidence: "alta" | "media" | "baja";
  amount?: number;
  date?: string; // YYYY-MM-DD
  cuit?: string; // 30-12345678-9
  merchant?: string;
  docLabel?: string; // "Factura B 0003-00001234"
  docKey?: string; // "6-3-1234" (tipo-ptoVta-nro) para detectar duplicados
  isCredit?: boolean; // nota de crédito => reintegro
  currencyNote?: string; // "USD 100 × 1.000"
  text?: string; // texto OCR (para depurar)
  // Comprobante de pago con tarjeta / QR (Mercado Pago, Posnet, Getnet, Payway…)
  voucher?: {
    provider?: string; // "Mercado Pago"
    method?: string; // "Prepaga Visa", "Débito Mastercard", "QR"
    last4?: string;
    operation?: string; // número de operación (para no cargarlo dos veces)
    installments?: number;
  };
}

const TIPOS: Record<number, string> = {
  1: "Factura A", 2: "Nota de débito A", 3: "Nota de crédito A",
  6: "Factura B", 7: "Nota de débito B", 8: "Nota de crédito B",
  11: "Factura C", 12: "Nota de débito C", 13: "Nota de crédito C",
  51: "Factura M", 52: "Nota de débito M", 53: "Nota de crédito M",
  81: "Tique factura A", 82: "Tique factura B", 83: "Tique", 111: "Tique factura C",
  201: "Factura de crédito A", 203: "Nota de crédito FCE A", 206: "Factura de crédito B",
  208: "Nota de crédito FCE B", 211: "Factura de crédito C", 213: "Nota de crédito FCE C",
};
const CREDITOS = new Set([3, 8, 13, 53, 203, 208, 213]);

export const fmtCuit = (c: string | number) => {
  const d = String(c).replace(/\D/g, "").padStart(11, "0");
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
};

/** Dígito verificador de CUIT/CUIL */
export function validCuit(c: string): boolean {
  const d = c.replace(/\D/g, "");
  if (d.length !== 11) return false;
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = w.reduce((s, x, i) => s + x * Number(d[i]), 0);
  let v = 11 - (sum % 11);
  if (v === 11) v = 0;
  if (v === 10) v = 9;
  return v === Number(d[10]);
}

// ---------------------------------------------------------------------------
// Imagen
// ---------------------------------------------------------------------------

export async function fileToCanvas(file: File, maxSide = 2000): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext("2d", { willReadFrequently: true })!.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function region(src: HTMLCanvasElement, x: number, y: number, w: number, h: number, target: number) {
  const s = Math.min(2, target / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
  return ctx.getImageData(0, 0, c.width, c.height);
}

// ---------------------------------------------------------------------------
// QR AFIP / ARCA
// ---------------------------------------------------------------------------

type ZX = typeof import("zxing-wasm/reader");
let zxPromise: Promise<ZX> | null = null;
function zxing(): Promise<ZX> {
  if (!zxPromise) {
    zxPromise = import("zxing-wasm/reader").then((m) => {
      // WASM servido por la propia app (sin CDN; la CSP lo exige)
      m.prepareZXingModule({
        overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? "/zxing/zxing_reader.wasm" : prefix + path) },
        fireImmediately: true,
      });
      return m;
    });
  }
  return zxPromise;
}

/** Lee un QR de un cuadro (lo usa también la cámara en vivo) */
export async function readQR(img: ImageData): Promise<string | null> {
  const { readBarcodes } = await zxing();
  const r = await readBarcodes(img, { formats: ["QRCode"], tryHarder: true, maxNumberOfSymbols: 1 });
  return r[0]?.text || null;
}

export async function findQR(canvas: HTMLCanvasElement): Promise<string | null> {
  const W = canvas.width, H = canvas.height;
  // Imagen completa, luego mitades y cuadrantes ampliados (el QR suele estar abajo)
  const tries: [number, number, number, number, number][] = [
    [0, 0, W, H, 2000], [0, H / 2, W, H / 2, 1600], [0, (H * 2) / 3, W, H / 3, 1400],
    [0, 0, W / 2, H / 2, 1200], [W / 2, 0, W / 2, H / 2, 1200],
    [0, H / 2, W / 2, H / 2, 1200], [W / 2, H / 2, W / 2, H / 2, 1200],
  ];
  for (const [x, y, w, h, t] of tries) {
    const text = await readQR(region(canvas, x, y, w, h, t));
    if (text) return text;
  }
  return null;
}

export function parseAfipQR(text: string): ScanResult | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (!/(afip|arca)\.gob\.ar$/i.test(url.hostname) || !/\/fe\/qr/i.test(url.pathname)) return null;
  const p = url.searchParams.get("p");
  if (!p) return null;
  let j: Record<string, unknown>;
  try {
    const b64 = p.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
    const bin = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "="));
    j = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
  } catch {
    return null;
  }
  const tipo = Number(j.tipoCmp);
  const pto = Number(j.ptoVta);
  const nro = Number(j.nroCmp);
  const importe = Number(j.importe);
  const moneda = String(j.moneda ?? "PES").toUpperCase();
  const ctz = Number(j.ctz ?? 1) || 1;
  if (!Number.isFinite(importe) || importe <= 0) return null;

  const amount = Math.round((moneda === "PES" ? importe : importe * ctz) * 100) / 100;
  const label = TIPOS[tipo] ?? `Comprobante ${tipo}`;
  const fecha = typeof j.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(j.fecha) ? j.fecha : undefined;
  return {
    source: "qr",
    confidence: "alta",
    amount,
    date: fecha,
    cuit: j.cuit ? fmtCuit(j.cuit as number) : undefined,
    docLabel: `${label} ${String(pto).padStart(4, "0")}-${String(nro).padStart(8, "0")}`,
    docKey: `${tipo}-${pto}-${nro}`,
    isCredit: CREDITOS.has(tipo),
    currencyNote: moneda !== "PES" ? `${moneda === "DOL" ? "USD" : moneda} ${importe} × ${ctz}` : undefined,
  };
}

// ---------------------------------------------------------------------------
// OCR de respaldo
// ---------------------------------------------------------------------------

/** Encuentra el rectángulo del papel (claro y poco saturado) para descartar la mesa/mantel */
function paperBox(canvas: HTMLCanvasElement) {
  const sw = 300, sh = Math.max(1, Math.round((canvas.height / canvas.width) * 300));
  const c = document.createElement("canvas");
  c.width = sw; c.height = sh;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0, sw, sh);
  const d = ctx.getImageData(0, 0, sw, sh).data;
  const col = new Float32Array(sw), row = new Float32Array(sh);
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < sw; x++) {
      const i = (y * sw + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const paper = max > 150 && (max - min) / (max || 1) < 0.22 ? 1 : 0;
      col[x] += paper; row[y] += paper;
    }
  const run = (arr: Float32Array, n: number, frac: number) => {
    let best = [0, n - 1], cur = -1;
    let bestLen = 0;
    for (let i = 0; i <= n; i++) {
      const on = i < n && arr[i] / (arr === col ? sh : sw) > frac;
      if (on && cur < 0) cur = i;
      if (!on && cur >= 0) {
        if (i - cur > bestLen) { bestLen = i - cur; best = [cur, i - 1]; }
        cur = -1;
      }
    }
    return { a: best[0], b: best[1], len: bestLen };
  };
  const cx = run(col, sw, 0.35), cy = run(row, sh, 0.2);
  const k = canvas.width / sw;
  const box = { x: cx.a * k, y: cy.a * k, w: (cx.b - cx.a + 1) * k, h: (cy.b - cy.a + 1) * k };
  // Si no hay un papel claro (foto ya recortada o documento), usar todo
  if (cx.len < sw * 0.15 || cy.len < sh * 0.15 || (cx.len > sw * 0.95 && cy.len > sh * 0.95))
    return { x: 0, y: 0, w: canvas.width, h: canvas.height };
  const m = 0.02 * canvas.width;
  return {
    x: Math.max(0, box.x - m), y: Math.max(0, box.y - m),
    w: Math.min(canvas.width - Math.max(0, box.x - m), box.w + 2 * m),
    h: Math.min(canvas.height - Math.max(0, box.y - m), box.h + 2 * m),
  };
}

function preprocess(canvas: HTMLCanvasElement, opts: { crop: boolean; width: number }): HTMLCanvasElement {
  // Tickets fotografiados: recortar al papel. Documentos/capturas: usar la página entera.
  const b = opts.crop ? paperBox(canvas) : { x: 0, y: 0, w: canvas.width, h: canvas.height };
  // Ancho objetivo (letra legible para el OCR), máx. ~8 MP
  let s = Math.min(4, opts.width / b.w);
  if (b.w * s * b.h * s > 8e6) s = Math.sqrt(8e6 / (b.w * b.h));
  const c = document.createElement("canvas");
  c.width = Math.round(b.w * s);
  c.height = Math.round(b.h * s);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, b.x, b.y, b.w, b.h, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  // Escala de grises + estiramiento de contraste (percentiles 1% / 99%)
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const g = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
    d[i] = g;
    hist[g]++;
  }
  const total = d.length / 4;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > total * 0.01) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > total * 0.01) { hi = v; break; } }
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((d[i] - lo) / range) * 255));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export async function ocr(
  canvas: HTMLCanvasElement,
  onProgress?: (p: number) => void,
  opts: { crop: boolean; width: number } = { crop: true, width: 1500 },
): Promise<string> {
  const { createWorker, PSM } = await import("tesseract.js");
  const worker = await createWorker("spa", 1, {
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract/core",
    langPath: "/tesseract/lang",
    workerBlobURL: false,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text") onProgress?.(m.progress);
    },
  });
  try {
    // Un ticket es un bloque uniforme de texto: este modo lo lee mucho mejor que el automático
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: "1" });
    const { data } = await worker.recognize(preprocess(canvas, opts));
    return data.text ?? "";
  } finally {
    await worker.terminate();
  }
}

const AMOUNT_RE = /\$?\s*(\d{1,3}(?:[.\s]\d{3})+(?:,\d{1,2})?|\d+,\d{1,2}|\d+\.\d{2}(?!\d)|\d{2,})/g;

export function parseReceiptText(text: string): ScanResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").replace(/(\s+[^\w$\s]{1,2}|\s+[a-zñ|]{1,2})+$/i, "").trim())
    .filter(Boolean);
  const res: ScanResult = { source: "ocr", confidence: "baja", text };

  // --- Total con validación cruzada: el OCR puede confundir un dígito (6↔0, 8↔3),
  // pero el mismo importe aparece en TOTAL, en el medio de pago y en "suma de sus pagos".
  const amountsIn = (l: string) =>
    [...l.matchAll(AMOUNT_RE)].map((m) => parseAmount(m[1])).filter((n) => Number.isFinite(n) && n > 0 && n < 1e9);
  const lastAmount = (re: RegExp, exclude?: RegExp) => {
    let v: number | undefined;
    for (const l of lines) if (re.test(l) && !(exclude && exclude.test(l))) {
      const a = amountsIn(l);
      if (a.length) v = a[a.length - 1];
    }
    return v;
  };
  const total = lastAmount(/\bTOTAL\b/i, /(SUB\s*-?\s*TOTAL|AHORRO|TOT\s+AHORRO|IVA)/i);
  const pagos = lines
    .filter((l) => /(A PAGAR|SUMA DE SUS PAGOS|TARJETA|EFECTIVO|D[EÉ]BITO|CR[EÉ]DITO|MERCADO ?PAGO|QR)/i.test(l) && !/VUELTO/i.test(l))
    .map((l) => amountsIn(l).pop())
    .filter((n): n is number => n !== undefined);
  const sub = lastAmount(/SUB\s*-?\s*TOTAL/i);
  const desc = lastAmount(/DESCUENTO/i);
  const calc = sub !== undefined && desc !== undefined ? Math.round((sub - Math.abs(desc)) * 100) / 100 : undefined;

  const votes = new Map<number, number>();
  const vote = (v: number | undefined, w: number) => v !== undefined && votes.set(v, (votes.get(v) ?? 0) + w);
  vote(total, 2);
  pagos.forEach((v) => vote(v, 1));
  vote(calc, 1);
  const ranked = [...votes.entries()].sort((x, y) => y[1] - x[1] || y[0] - x[0]);
  if (ranked.length) {
    res.amount = ranked[0][0];
    // Coinciden 2+ fuentes => confiable; una sola => revisar
    res.confidence = ranked[0][1] >= 3 ? "alta" : ranked[0][1] >= 2 ? "media" : "baja";
  }

  // --- Fecha
  const today = localISO();
  for (const m of text.matchAll(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/g)) {
    const d = Number(m[1]), mo = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 2015 || y > 2100) continue;
    const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (iso > today) continue;
    res.date = iso;
    break;
  }

  // --- CUIT del emisor (con dígito verificador válido)
  for (const m of text.matchAll(/\b(\d{2})[\s\-.]?(\d{8})[\s\-.]?(\d)\b/g)) {
    const c = m[1] + m[2] + m[3];
    if (validCuit(c)) {
      res.cuit = fmtCuit(c);
      break;
    }
  }

  // --- Comercio: "A CUENTA Y ORDEN DE <marca>" (franquicias) o primera línea con nombre
  const ord = text.match(/CUENTA Y ORDEN DE\s+([^\n]+)/i);
  if (ord) res.merchant = ord[1].replace(/[^\wÁÉÍÓÚÑáéíóúñ&. ]/g, "").replace(/\s+\S{1,2}$/, "").trim().slice(0, 60);
  const skip = /(CUIT|IVA|INGRESOS BRUTOS|ING\.? ?BR|FECHA|HORA|TICKET|FACTURA|P\.?V\.?|NRO|N[º°]|CAJA|C[ÓO]D|DIRECCI|DOMICILIO|TEL|RESPONSABLE|CONSUMIDOR|INICIO)/i;
  for (const l of res.merchant ? [] : lines.slice(0, 8)) {
    if (l.length < 6 || !/\s/.test(l)) continue;
    const letters = (l.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ]/g) ?? []).length;
    if (letters >= 4 && letters / l.length > 0.6 && !skip.test(l)) {
      res.merchant = l.replace(/[^\wÁÉÍÓÚÑáéíóúñ&.\- ]/g, "").trim().slice(0, 60);
      break;
    }
  }
  return res;
}

// ---------------------------------------------------------------------------
// Comprobantes de pago (posnet / Mercado Pago Point / QR)
// ---------------------------------------------------------------------------

/** El OCR confunde letras con números en los últimos 4 de la tarjeta ("DOS5" = 0055) */
const fixDigits = (s: string) => s.toUpperCase().replace(/[OQD]/g, "0").replace(/[SZ]/g, "5").replace(/[IL|]/g, "1").replace(/B/g, "8");

const BRANDS: [RegExp, string][] = [
  [/VISA/i, "Visa"], [/MASTER\s*CARD|MASTER/i, "Mastercard"], [/MAESTRO/i, "Maestro"], [/AMEX|AMERICAN\s*EXP/i, "American Express"],
  [/CABAL/i, "Cabal"], [/NARANJA/i, "Naranja"], [/ARGENCARD/i, "Argencard"],
];
const SMALL = new Set(["e", "y", "de", "del", "la", "las", "los", "el"]);
const LEGAL = /^(S\.?A\.?S?|S\.?R\.?L\.?|S\.?A\.?U|S\.?H|S\.?C\.?A|SAS)$/i;

/** "CARLOS D ALMIRÓN E HIJOS SA" -> "Carlos D Almirón e Hijos SA" (si viene todo en mayúsculas) */
export function prettyMerchant(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t !== t.toUpperCase()) return t;
  return t.split(" ").map((w, i) => {
    if (LEGAL.test(w)) return w.replace(/\./g, "").toUpperCase();
    const lw = w.toLowerCase();
    if (i > 0 && SMALL.has(lw)) return lw;
    return lw.charAt(0).toUpperCase() + lw.slice(1);
  }).join(" ");
}

export function isPaymentVoucher(text: string): boolean {
  const t = text.toUpperCase();
  const signals = [
    /\bAPROBAD[OA]\b/, /OPERACI[OÓ]N/, /TICKET\s+(CLIENTE|VENDEDOR|COMERCIO)/, /\bAID\s*[:;]/, /\bNFC\b/,
    /MERCADO|\bPAGO\b/, /COMPROBANTE\s+DE\s+PAGO/, /\bCUOTAS?\b/, /N[UÚ]MERO\s+DE\s+SERIE|SMARTPOS/,
  ].filter((re) => re.test(t)).length;
  return /\bAPROBAD[OA]\b/.test(t) && signals >= 3;
}

/**
 * Comprobante de pago (no es factura fiscal): total, fecha, comercio, CUIT, medio de pago y nº de operación.
 * El total se valida contra el detalle de cuotas "(1x $ 36.000,00)".
 */
export function parsePaymentVoucher(text: string, base: ScanResult): ScanResult {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/[|]/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  const res: ScanResult = { ...base, voucher: {} };
  const v = res.voucher!;
  const up = text.toUpperCase();

  if (/MERCADO/.test(up) || /\bNN?,?\s*PAGO\b/.test(up) || /SMARTPOS/.test(up)) v.provider = "Mercado Pago";
  else if (/GETNET/.test(up)) v.provider = "Getnet";
  else if (/PAYWAY|POSNET/.test(up)) v.provider = "Payway";
  else if (/CLOVER|FISERV|FIRST\s*DATA/.test(up)) v.provider = "Fiserv";

  // Total: línea "Total" y detalle de cuotas "(Nx $ importe)"
  const amt = (s: string) => {
    const m = [...s.matchAll(AMOUNT_RE)].map((x) => parseAmount(x[1])).filter((n) => Number.isFinite(n) && n > 0 && n < 1e9);
    return m.length ? m[m.length - 1] : undefined;
  };
  const totalLine = lines.find((l) => /^\W*TOTAL\b/i.test(l));
  const total = totalLine ? amt(totalLine) : undefined;
  const cuo = text.match(/\(\s*(\d{1,2})\s*[xX×]\s*\$?\s*([\d.,]+)\s*\)/);
  const each = cuo ? parseAmount(cuo[2]) : undefined;
  const n = cuo ? Number(cuo[1]) : undefined;
  if (n) v.installments = n;
  const fromCuotas = n && each ? Math.round(n * each * 100) / 100 : undefined;
  if (total !== undefined && fromCuotas !== undefined && Math.abs(total - fromCuotas) <= Math.max(1, n!)) {
    res.amount = total;
    res.confidence = "alta";
  } else if (total !== undefined || fromCuotas !== undefined) {
    res.amount = total ?? fromCuotas;
    res.confidence = "media";
  }

  // Medio de pago
  const pm = up.match(/\b(PREPAGA|D[EÉ]BITO|CR[EÉ]DITO)\b[^\n]{0,25}/);
  const brand = BRANDS.find(([re]) => re.test(pm?.[0] ?? up))?.[1];
  const kind = pm ? (pm[1].startsWith("PRE") ? "Prepaga" : pm[1].startsWith("D") ? "Débito" : "Crédito") : undefined;
  if (kind || brand) v.method = [kind, brand].filter(Boolean).join(" ");
  else if (/\bQR\b|DINERO EN CUENTA/.test(up)) v.method = /DINERO EN CUENTA/.test(up) ? "Dinero en cuenta" : "QR";
  const l4 = pm?.[0].match(/\s([0-9OQDSZILB]{4})(?=\s|$)/);
  if (l4) {
    const d = fixDigits(l4[1]);
    if (/^\d{4}$/.test(d)) v.last4 = d;
  }

  // Nº de operación: el "#" a veces se lee como "4" pegado adelante
  const op = text.match(/OPERACI[OÓ]N\s*(?:N[º°ro.]*\s*)?(#|4\s|41\s)?\s*([\d ]{8,18})/i);
  if (op) {
    let num = op[2].replace(/\D/g, "");
    if (op[1] && op[1].trim() !== "#") num = (op[1].trim().slice(1) + num); // "41 823…" -> "1823…"
    if (!op[1] && num.length === 13 && num.startsWith("4")) num = num.slice(1);
    if (num.length >= 8 && num.length <= 16) v.operation = num;
  }

  // Comercio: renglones entre "APROBADO" y el que tiene el CUIT (el nombre puede ocupar dos líneas)
  const iAp = lines.findIndex((l) => /APROBAD[OA]/i.test(l));
  if (iAp >= 0) {
    const parts: string[] = [];
    for (const l of lines.slice(iAp + 1, iAp + 5)) {
      const hasCuit = /\b\d{2}[\s\-.]?\d{8}[\s\-.]?\d\b/.test(l);
      if (!hasCuit && /\d{3,}.*,|,.*\d{3,}|PROVINCIA|ARGENTIN|N[UÚ]MERO DE SERIE/i.test(l)) break; // dirección
      const name = l.replace(/\b\d{2}[\s\-.]?\d{8}[\s\-.]?\d\b/, "").replace(/[^\wÁÉÍÓÚÑÜáéíóúñü&.' -]/g, "").trim();
      if (name) parts.push(name);
      if (hasCuit) break;
    }
    const m = parts.join(" ").replace(/\s+/g, " ").trim();
    if (m.length >= 3) res.merchant = prettyMerchant(m).slice(0, 60);
  }

  res.docLabel = [
    v.provider,
    v.method && `${v.method}${v.last4 ? ` ••${v.last4}` : ""}`,
    v.installments && v.installments > 1 ? `${v.installments} cuotas` : null,
    v.operation && `Op. ${v.operation}`,
  ].filter(Boolean).join(" · ") || "Comprobante de pago";
  if (v.operation) res.docKey = `op-${v.operation}`;
  return res;
}

/** Clave estable de un comercio: CUIT si existe, si no el nombre normalizado */
export function merchantKey(r: Pick<ScanResult, "cuit" | "merchant">): string | null {
  if (r.cuit) return r.cuit.replace(/\D/g, "");
  if (r.merchant) {
    const k = r.merchant.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return k.length >= 3 ? k.slice(0, 80) : null;
  }
  return null;
}

/** Pipeline completo */
export async function scanReceipt(file: File, onStatus: (s: string) => void): Promise<ScanResult> {
  onStatus("Preparando la imagen…");
  const canvas = await fileToCanvas(file);
  onStatus("Buscando el código QR de la factura…");
  const qr = await findQR(canvas);
  if (qr) {
    const r = parseAfipQR(qr);
    if (r) return r;
  }
  onStatus("No hay QR fiscal. Leyendo el texto del ticket…");
  const text = await ocr(canvas, (p) => onStatus(`Leyendo el texto del ticket… ${Math.round(p * 100)}%`));
  // Solo en builds de prueba (la variable no existe en Vercel): deja el texto OCR para depurar
  if (process.env.NEXT_PUBLIC_SCAN_DEBUG === "1") (window as unknown as { __scanText?: string }).__scanText = text;
  const r = parseReceiptText(text);
  return isPaymentVoucher(text) ? parsePaymentVoucher(text, r) : r;
}
