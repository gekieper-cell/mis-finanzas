import { Shell } from "@/components/Shell";

/**
 * Layout ESTÁTICO: las pantallas se prearman y el celular las descarga por adelantado,
 * así la navegación es instantánea (sin esperar al servidor en cada toque).
 * Seguridad: el proxy valida la sesión en cada pedido y redirige a /login;
 * los datos se leen de Supabase con RLS (sin sesión no hay datos).
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <Shell>{children}</Shell>;
}
