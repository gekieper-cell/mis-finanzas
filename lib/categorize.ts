import type { Category } from "./types";

/**
 * Categoría sugerida para un consumo del resumen.
 * Prioridad: 1) lo que ya aprendió la app de ese comercio (tabla merchants)
 *            2) reglas por palabra clave
 * Las reglas apuntan a NOMBRES de categoría; si el usuario las renombró, no aplican (queda sin categoría).
 */
const RULES: [RegExp, string[]][] = [
  [/SEGURO/i, ["Seguro", "Transporte"]],
  [/\bYPF\b|SHELL|AXION|PUMA ENERG|COMBUSTIBLE|NAFTA|ESTACION DE SERV/i, ["Combustible", "Transporte"]],
  [/PEAJE|AUTOPISTA|TELEPASE|ESTACIONAM|\bSUBE\b|UBER|CABIFY|DIDI/i, ["Transporte"]],
  [/PATENTE|ARBA|AGIP|TALLER|GOMERIA|LUBRIC/i, ["Patente / Mantenimiento", "Transporte"]],
  [/FARMA|DROGUER|OSDE|SWISS MEDICAL|GALENO|MEDIFE|OMINT|CLINICA|SANATORIO|HOSPITAL|ODONTO|LABORATORIO/i, ["Salud"]],
  [/EDENOR|EDESUR|EDELAP|\bLUZ\b/i, ["Luz", "Vivienda & Servicios"]],
  [/METROGAS|NATURGY|CAMUZZI|LITORAL GAS/i, ["Gas", "Vivienda & Servicios"]],
  [/TELECOM|PERSONAL|MOVISTAR|CLARO|FIBERTEL|\bFLOW\b|TELECENTRO|DIRECTV|STARLINK/i, ["Internet / Teléfono", "Vivienda & Servicios"]],
  [/EXPENSAS|ALQUILER|INMOBILIARIA/i, ["Alquiler / Expensas", "Vivienda & Servicios"]],
  [/EASY|SODIMAC|FRAVEGA|GARBARINO|MUSIMUNDO|HOMECENTER|BLAISTEN|TIENDAHOGAR|HOGAR|PINTURERIA|FERRETER/i, ["Vivienda & Servicios"]],
  [/SPOTIFY|NETFLIX|DISNEY|HBO|\bMAX\b|PARAMOUNT|YOUTUBE|DEEZER|CRUNCHY|STAR\s?\+|PRIME VIDEO|GIMNASIO|SMART\s?FIT|MEGATLON|CINE|TEATRO|TICKET/i, ["Bienestar"]],
  [/LINKEDIN|OPENAI|CHATGPT|ANTHROPIC|CLAUDE|MICROSOFT|OFFICE|ADOBE|DROPBOX|CANVA|GOOGLE|APPLE\.COM|ICLOUD/i, ["Bienestar"]],
  [/IIBB|IVA\s*RG|DB\.?\s*RG|PERCEP|IMPUESTO|SELLOS|COMISI|INTER[EÉ]S|CARGO|MANTENIM|BANCO|PRESTAMO/i, ["Finanzas"]],
];

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function guessCategory(description: string, categories: Category[]): string | null {
  const active = categories.filter((c) => c.kind === "expense" && !c.archived);
  for (const [re, names] of RULES) {
    if (!re.test(description)) continue;
    for (const n of names) {
      const c = active.find((x) => norm(x.name) === norm(n));
      if (c) return c.id;
    }
  }
  return null;
}
