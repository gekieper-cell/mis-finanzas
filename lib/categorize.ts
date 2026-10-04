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
  [/GIMNASIO|\bGYM\b|SMART\s?FIT|MEGATLON|SPORTCLUB|SPORT CLUB|CROSSFIT|FITNESS|PILATES|NATACI/i, ["Gimnasio", "Bienestar"]],
  [/SPOTIFY|NETFLIX|DISNEY|HBO|\bMAX\b|PARAMOUNT|YOUTUBE|DEEZER|CRUNCHY|STAR\s?\+|PRIME VIDEO|LINKEDIN|OPENAI|CHATGPT|ANTHROPIC|CLAUDE|MICROSOFT|OFFICE|ADOBE|DROPBOX|CANVA|GOOGLE|APPLE\.COM|ICLOUD/i, ["Streaming y apps", "Bienestar"]],
  [/CINE|TEATRO|TICKETEK|TICKETPORTAL|ALL ACCESS/i, ["Bienestar"]],
  [/SUPERMERCADO|\bSUPER\b|\bDIA\b|COTO|CARREFOUR|JUMBO|DISCO|\bVEA\b|CHANGOMAS|MAS ONLINE|LA AN[OÓ]NIMA|MAXICONSUMO|VITAL|YAGUAR|DIARCO|MAKRO|AUTOSERVICIO|ALMAC[EÉ]N|CARNICER|VERDULER|FIAMBRER|PANADER|GRANJA|DIETETICA/i, ["Supermercado", "Comida"]],
  [/PEDIDOSYA|PEDIDOS YA|RAPPI|MCDONALD|MC DONALD|BURGER|MOSTAZA|KFC|SUBWAY|PIZZ|EMPANAD|PARRILLA|RESTO|RESTAURANT|BODEGON|SUSHI|HELADER|GRIDO|FREDDO|RAPANUI|CERVECER/i, ["Restaurantes y delivery", "Comida"]],
  [/KIOSCO|KIOSKO|MAXIKIOSCO|DRUGSTORE|POLIRUBRO|CAF[EÉ]|STARBUCKS|HAVANNA|BONAFIDE|PANINI/i, ["Kiosco y café", "Comida"]],
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
