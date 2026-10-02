import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import { LOCK_BOOT_SCRIPT } from "@/lib/applock";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mis Finanzas",
  description: "Finanzas personales",
  applicationName: "Mis Finanzas",
  appleWebApp: { capable: true, title: "Mis Finanzas", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR" suppressHydrationWarning>
      <head>
        {/* Si el candado Face ID está activo, la app arranca tapada (antes del primer pintado) */}
        <script dangerouslySetInnerHTML={{ __html: LOCK_BOOT_SCRIPT }} />
      </head>
      <body className="font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
