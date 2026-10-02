import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login"];

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

function configError(detail: string) {
  // Mensaje legible en vez de un 500 opaco. No expone valores, solo qué falta.
  return new NextResponse(`Error de configuración: ${detail}`, {
    status: 500,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function proxy(request: NextRequest) {
  if (!SUPABASE_URL) return configError("falta NEXT_PUBLIC_SUPABASE_URL en Vercel (Production).");
  if (!/^https?:\/\/[^\s/]+$/.test(SUPABASE_URL))
    return configError("NEXT_PUBLIC_SUPABASE_URL tiene un formato inválido (¿espacios o barra final?).");
  if (!SUPABASE_KEY) return configError("falta NEXT_PUBLIC_SUPABASE_ANON_KEY en Vercel (Production).");

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    SUPABASE_URL,
    SUPABASE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // getClaims() verifica la FIRMA del JWT: con claves asimétricas lo hace localmente (rápido, sin red);
  // con clave simétrica consulta a Supabase Auth como getUser(). Nunca confía en la cookie a ciegas.
  let user: { sub: string } | null = null;
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error && "status" in error && typeof error.status === "number" && error.status >= 500)
      return configError(`Supabase Auth respondió ${error.status}.`);
    user = data?.claims?.sub ? { sub: data.claims.sub } : null;
  } catch (e) {
    console.error("proxy getUser", e);
    return configError("no se pudo contactar a Supabase. Revisá la URL y la clave.");
  }

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons/|tesseract/|zxing/|pdfjs/|manifest.webmanifest|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)",
  ],
};
