"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, ImageUp, X } from "lucide-react";
import { parseAfipQR, readQR, type ScanResult } from "@/lib/scan";

/**
 * Cámara en vivo: busca el QR fiscal de AFIP/ARCA varias veces por segundo mientras apuntás.
 * Para tickets sin QR, "Sacar foto" abre la cámara nativa del iPhone (más resolución y foco)
 * y la foto se lee con OCR. Nada sale del dispositivo.
 */
export function Scanner({
  open,
  onClose,
  onResult,
  onPhoto,
}: {
  open: boolean;
  onClose: () => void;
  onResult: (r: ScanResult) => void;
  onPhoto: (f: File) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"starting" | "scanning" | "nocamera">("starting");
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let n = 0;
    const canvas = document.createElement("canvas");
    setState("starting");
    setHint(null);

    const tick = async () => {
      const v = videoRef.current;
      if (!alive || !v || v.readyState < 2) {
        timer = setTimeout(tick, 200);
        return;
      }
      // Alterna: cuadro central (más resolución para QR lejanos) y cuadro completo (QR grandes/cercanos)
      n++;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      let w: number, h: number;
      if (n % 2) {
        const side = Math.min(v.videoWidth, v.videoHeight) * 0.85;
        const out = Math.min(1000, side);
        canvas.width = canvas.height = w = h = out;
        ctx.drawImage(v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side, 0, 0, out, out);
      } else {
        const k = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
        canvas.width = w = Math.round(v.videoWidth * k);
        canvas.height = h = Math.round(v.videoHeight * k);
        ctx.drawImage(v, 0, 0, w, h);
      }
      try {
        const text = await readQR(ctx.getImageData(0, 0, w, h));
        if (text && alive) {
          const r = parseAfipQR(text);
          if (r) {
            navigator.vibrate?.(60);
            alive = false;
            onResult(r);
            return;
          }
          setHint("Ese QR no es de una factura (AFIP/ARCA). Buscá el QR fiscal, suele estar al pie.");
        }
      } catch (e) {
        console.error(e);
      }
      if (alive) timer = setTimeout(tick, 150);
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState("nocamera");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (!alive) return;
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play().catch(() => {});
        setState("scanning");
        tick();
      } catch {
        setState("nocamera");
      }
    })();

    return () => {
      alive = false;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open, onResult]);

  if (!open) return null;

  const pick = (f?: File) => {
    if (f) onPhoto(f);
  };

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black text-white">
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      <input ref={galRef} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />

      <div className="flex items-center justify-between px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <span className="font-semibold">Escanear factura</span>
        <button onClick={onClose} className="rounded-full bg-white/15 p-2" aria-label="Cerrar">
          <X size={20} />
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 h-full w-full object-cover" />
        {state !== "nocamera" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="aspect-square w-[72%] max-w-[340px] rounded-3xl border-4 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
          </div>
        )}
        <div className="absolute inset-x-0 top-4 px-6 text-center text-sm">
          {state === "starting" && <p className="rounded-xl bg-black/50 px-3 py-2">Abriendo la cámara…</p>}
          {state === "scanning" && (
            <p className="rounded-xl bg-black/50 px-3 py-2">{hint ?? "Apuntá al código QR de la factura (suele estar al pie)"}</p>
          )}
          {state === "nocamera" && (
            <p className="mt-24 rounded-xl bg-white/10 px-4 py-3">
              No se pudo abrir la cámara en vivo. Revisá el permiso de cámara para este sitio en Ajustes, o sacá una foto.
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4">
        <button
          onClick={() => camRef.current?.click()}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-white font-medium text-slate-900"
        >
          <Camera size={18} /> Ticket sin QR: sacar foto
        </button>
        <button onClick={() => galRef.current?.click()} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-white/15 text-sm font-medium">
          <ImageUp size={17} /> Elegir de la galería
        </button>
      </div>
    </div>
  );
}
