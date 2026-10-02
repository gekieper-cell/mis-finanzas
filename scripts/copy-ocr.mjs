// Copia los archivos del OCR (Tesseract) a /public para servirlos desde la propia app:
// sin CDNs externos (la CSP lo bloquearía) y sin mandar imágenes a terceros.
import { cpSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const out = "public/tesseract";
const pkgDir = (name) => {
  try {
    return dirname(require.resolve(`${name}/package.json`));
  } catch {
    // paquetes con "exports" que no publican package.json (p. ej. zxing-wasm)
    return join(process.cwd(), "node_modules", name);
  }
};

const files = [
  [join(pkgDir("tesseract.js"), "dist/worker.min.js"), `${out}/worker.min.js`],
  ...["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"].map(
    (f) => [join(pkgDir("tesseract.js-core"), f), `${out}/core/${f}`],
  ),
  [join(pkgDir("@tesseract.js-data/spa"), "4.0.0_best_int/spa.traineddata.gz"), `${out}/lang/spa.traineddata.gz`],
  // Lector de QR (ZXing WASM)
  [join(pkgDir("zxing-wasm"), "dist/reader/zxing_reader.wasm"), "public/zxing/zxing_reader.wasm"],
];

// Lector de PDF (pdf.js): worker + mapas de caracteres + fuentes estándar
const pdf = pkgDir("pdfjs-dist");
files.push(
  [join(pdf, "legacy/build/pdf.worker.min.mjs"), "public/pdfjs/pdf.worker.min.mjs"],
  [join(pdf, "cmaps"), "public/pdfjs/cmaps"],
  [join(pdf, "standard_fonts"), "public/pdfjs/standard_fonts"],
);

for (const [src, dst] of files) {
  if (!existsSync(src)) throw new Error(`Falta ${src}`);
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst, { recursive: true });
}
console.log(`OCR/QR: ${files.length} archivos copiados a public/`);
