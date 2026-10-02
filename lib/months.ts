const M = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MF = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** "2027-07" -> "jul 2027" */
export const fmtYM = (ym: string) => `${M[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
/** "2027-07" -> "jul/27" (ejes de gráficos) */
export const fmtYMShort = (ym: string) => `${M[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`;
/** "2027-07" -> "julio 2027" */
export const fmtYMLong = (ym: string) => `${MF[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
