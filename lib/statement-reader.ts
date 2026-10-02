"use client";

import { fileToCanvas, ocr } from "./scan";

/**
 * Obtiene el texto de un resumen de tarjeta, 100% en el navegador:
 * - PDF con texto (el que descargás del home banking): pdf.js, exacto y rápido.
 * - PDF escaneado o imagen/captura: OCR.
 * El archivo nunca sale del dispositivo.
 */

/** Documento entero (sin recorte) y a buena resolución */
const DOC = { crop: false, width: 1800 };

export class PdfPasswordError extends Error {
  constructor(public incorrect: boolean) {
    super(incorrect ? "Contraseña incorrecta" : "El PDF tiene contraseña");
  }
}

type PdfJs = typeof import("pdfjs-dist");

async function pdfjs(): Promise<PdfJs> {
  const m = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfJs;
  m.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  return m;
}

/** Reconstruye renglones a partir de las piezas de texto del PDF (por coordenada Y) */
function linesFromItems(items: { str: string; transform: number[] }[]): string[] {
  const rows: { y: number; parts: { x: number; s: string }[] }[] = [];
  for (const it of items) {
    if (!it.str?.trim()) continue;
    const x = it.transform[4], y = it.transform[5];
    let row = rows.find((r) => Math.abs(r.y - y) < 3);
    if (!row) rows.push((row = { y, parts: [] }));
    row.parts.push({ x, s: it.str });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((r) => r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(" ").replace(/\s+/g, " ").trim());
}

export async function statementText(
  file: File,
  onStatus: (s: string) => void,
  password?: string,
): Promise<{ text: string; method: "pdf" | "ocr" }> {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isPdf) {
    onStatus("Leyendo la imagen del resumen…");
    const canvas = await fileToCanvas(file, 2600);
    const text = await ocr(canvas, (p) => onStatus(`Leyendo la imagen del resumen… ${Math.round(p * 100)}%`), DOC);
    return { text, method: "ocr" };
  }

  onStatus("Abriendo el PDF…");
  const lib = await pdfjs();
  const task = lib.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    password,
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    isEvalSupported: false, // endurecimiento: nunca evaluar código del PDF
    disableAutoFetch: true,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    if ((e as { name?: string }).name === "PasswordException") {
      throw new PdfPasswordError((e as { code?: number }).code === 2);
    }
    throw e;
  }

  const pages = Math.min(doc.numPages, 10);
  const all: string[] = [];
  for (let i = 1; i <= pages; i++) {
    onStatus(`Leyendo página ${i} de ${pages}…`);
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    all.push(...linesFromItems(content.items as { str: string; transform: number[] }[]));
  }
  const text = all.join("\n");
  if (text.replace(/\s/g, "").length > 200) {
    await doc.destroy();
    return { text, method: "pdf" };
  }

  // PDF escaneado (solo imágenes): renderizar cada página y aplicar OCR
  const parts: string[] = [];
  for (let i = 1; i <= pages; i++) {
    onStatus(`PDF escaneado: leyendo página ${i} de ${pages}…`);
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 2.5 });
    const c = document.createElement("canvas");
    c.width = Math.round(vp.width);
    c.height = Math.round(vp.height);
    await page.render({ canvasContext: c.getContext("2d")!, viewport: vp }).promise;
    parts.push(await ocr(c, undefined, DOC));
  }
  await doc.destroy();
  return { text: parts.join("\n"), method: "ocr" };
}
