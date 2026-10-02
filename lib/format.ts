const money0 = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 });

// Modo privado: oculta todos los montos de la app
let privacy = false;
export const setPrivacy = (v: boolean) => {
  privacy = v;
};
export const MASK = "$ ••••••";

export const fmtMoney = (n: number) => {
  if (privacy) return MASK;
  const v = Math.round((n || 0) * 100) / 100;
  return (Number.isInteger(v) ? money0 : money2).format(v);
};
export const fmtCompact = (n: number) => (privacy ? "$•••" : (n < 0 ? "-$" : "$") + compact.format(Math.abs(n || 0)));

/** Acepta "1.890.000", "1890000,50", "1890000.5", "$ 12.000" */
export function parseAmount(input: string): number {
  let s = input.replace(/[^\d.,-]/g, "").trim();
  if (!s) return NaN;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1) {
    // coma = decimal (formato AR); puntos = miles
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > -1) {
    const decimals = s.length - lastDot - 1;
    const dots = (s.match(/\./g) || []).length;
    // "12.000" o "1.890.000" => miles; "1500.5" => decimal
    if (dots > 1 || decimals === 3) s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

/** Fecha local YYYY-MM-DD (evita el corrimiento de toISOString en UTC-3) */
export function localISO(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISO(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export const monthKey = (s: string) => s.slice(0, 7);

export function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}

export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const monthFmt = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" });
const monthShort = new Intl.DateTimeFormat("es-AR", { month: "short" });
const dayFmt = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short" });
const dayLong = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long" });

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const fmtMonth = (ym: string) => cap(monthFmt.format(parseISO(ym + "-01")));
export const fmtMonthShort = (ym: string) => cap(monthShort.format(parseISO(ym + "-01")).replace(".", ""));
export const fmtDay = (s: string) => dayFmt.format(parseISO(s)).replace(".", "");
export const fmtDayLong = (s: string) => cap(dayLong.format(parseISO(s)));

export function daysUntil(s: string): number {
  const today = parseISO(localISO());
  return Math.round((parseISO(s).getTime() - today.getTime()) / 86400000);
}
