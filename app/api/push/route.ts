import crypto from "node:crypto";
import webpush from "web-push";

/**
 * Entrega de avisos push. La llama SOLO la base de datos (pg_net) con un cuerpo firmado:
 *   { payload: "<json>", sig: hex(HMAC-SHA256(PUSH_SECRET, payload)) }
 * Vercel no tiene credenciales de Supabase: no lee ni escribe datos, solo reenvía lo firmado
 * a los servicios push (Apple / Google / Mozilla / Microsoft) usando las claves VAPID.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 64 * 1024;
const MAX_SKEW_S = 300; // la firma vale 5 minutos
const PUSH_HOSTS = [/^web\.push\.apple\.com$/, /\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];

type Sub = { id: string; endpoint: string; p256dh: string; auth: string };
type Note = { title: string; body?: string; url?: string; tag?: string };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

function allowedEndpoint(endpoint: string): boolean {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  const extra = (process.env.PUSH_ALLOW_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  if (u.protocol !== "https:" || u.username || u.password) return false;
  return PUSH_HOSTS.some((re) => re.test(u.hostname)) || extra.includes(u.host);
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
const safeUrl = (v: unknown) => (typeof v === "string" && /^\/(?!\/)[\w\-/?=&.%]*$/.test(v) ? v.slice(0, 200) : "/");

export async function POST(req: Request) {
  const secret = process.env.PUSH_SECRET;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!secret || secret.length < 32 || !pub || !priv) return json(503, { error: "push sin configurar" });

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(413, { error: "demasiado grande" });

  let body: { payload?: unknown; sig?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "json" });
  }
  if (typeof body.payload !== "string" || typeof body.sig !== "string" || !/^[0-9a-f]{64}$/.test(body.sig))
    return json(400, { error: "formato" });

  const expected = crypto.createHmac("sha256", secret).update(body.payload, "utf8").digest();
  if (!crypto.timingSafeEqual(expected, Buffer.from(body.sig, "hex"))) return json(401, { error: "firma" });

  let p: { v?: number; ts?: number; subs?: Sub[]; notifications?: Note[] };
  try {
    p = JSON.parse(body.payload);
  } catch {
    return json(400, { error: "payload" });
  }
  if (p.v !== 1 || typeof p.ts !== "number" || Math.abs(Date.now() / 1000 - p.ts) > MAX_SKEW_S) return json(401, { error: "vencido" });
  if (!Array.isArray(p.subs) || !Array.isArray(p.notifications) || p.subs.length > 20 || p.notifications.length > 10)
    return json(400, { error: "límites" });

  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", pub, priv);

  const notes = p.notifications
    .filter((n) => n && typeof n.title === "string")
    .map((n) => JSON.stringify({ title: str(n.title, 120), body: str(n.body, 300) ?? "", url: safeUrl(n.url), tag: str(n.tag, 120) }));

  const results: { id: string; status: number }[] = [];
  for (const s of p.subs) {
    if (!s || typeof s.endpoint !== "string" || !allowedEndpoint(s.endpoint)) {
      results.push({ id: String(s?.id ?? ""), status: 0 }); // host no permitido: no se contacta
      continue;
    }
    let status = 201;
    for (const n of notes) {
      try {
        const r = await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, n, {
          TTL: 24 * 3600,
          urgency: "normal",
          timeout: 10000,
        });
        status = r.statusCode;
      } catch (e) {
        status = (e as { statusCode?: number }).statusCode ?? 500;
        if (status === 404 || status === 410) break; // suscripción muerta: la base la borra
      }
    }
    results.push({ id: s.id, status });
  }
  return json(200, { results });
}

export function GET() {
  return json(405, { error: "method" });
}
