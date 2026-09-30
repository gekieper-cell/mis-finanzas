import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Defensa en profundidad: además del proxy, se valida la sesión en el servidor
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  return <Shell email={user.email ?? ""}>{children}</Shell>;
}
