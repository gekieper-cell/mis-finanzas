"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useTheme } from "next-themes";
import {
  ArrowLeftRight, CreditCard, Eye, EyeOff, History, LayoutDashboard, LogOut, Menu, Monitor, Moon, Plus, Repeat, Sun, Target, Wallet, X,
} from "lucide-react";
import { DataProvider, useData } from "@/lib/data";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Transaction } from "@/lib/types";
import { TxModal } from "./TxModal";
import { Spinner, cx } from "./ui";

const NAV = [
  { href: "/", label: "Resumen", icon: LayoutDashboard },
  { href: "/movimientos", label: "Movimientos", icon: ArrowLeftRight },
  { href: "/presupuestos", label: "Presupuestos", icon: Target },
  { href: "/cuentas", label: "Cuentas", icon: Wallet },
  { href: "/recurrentes", label: "Recurrentes", icon: Repeat },
  { href: "/cuotas", label: "Cuotas", icon: CreditCard },
  { href: "/actividad", label: "Actividad", icon: History },
];

const QuickCtx = createContext<(tx?: Transaction) => void>(() => {});
export const useQuickAdd = () => useContext(QuickCtx);

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <DataProvider>
      <Inner>{children}</Inner>
    </DataProvider>
  );
}

function Inner({ children }: { children: React.ReactNode }) {
  // Email solo para mostrar (la autorización la hacen el proxy y el RLS)
  const [email, setEmail] = useState("");
  useEffect(() => {
    supabaseBrowser()
      .auth.getSession()
      .then(({ data }) => setEmail(data.session?.user.email ?? ""));
  }, []);
  const path = usePathname();
  const router = useRouter();
  const { ready, error, hidden, toggleHidden } = useData();
  const [txOpen, setTxOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [menu, setMenu] = useState(false);

  const openTx = useCallback((tx?: Transaction) => {
    setEditing(tx ?? null);
    setTxOpen(true);
  }, []);

  async function logout() {
    await supabaseBrowser().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <QuickCtx.Provider value={openTx}>
      <div className="min-h-dvh bg-slate-50 dark:bg-slate-950">
        {/* Sidebar desktop */}
        <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-slate-200 bg-white px-4 py-6 dark:border-slate-800 dark:bg-slate-900 lg:flex">
          <div className="flex items-center justify-between">
            <Brand />
            <PrivacyButton hidden={hidden} onClick={toggleHidden} />
          </div>
          <button
            onClick={() => openTx()}
            className="mt-8 flex h-11 items-center justify-center gap-2 rounded-xl bg-brand-600 font-medium text-white shadow-lg shadow-brand-600/25 transition hover:bg-brand-700"
          >
            <Plus size={18} /> Nuevo movimiento
          </button>
          <nav className="mt-6 space-y-1">
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cx(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                  isActive(href)
                    ? "bg-brand-50 text-brand-700 dark:bg-brand-600/15 dark:text-brand-100"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800",
                )}
              >
                <Icon size={18} /> {label}
              </Link>
            ))}
          </nav>
          <div className="mt-auto space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
            <ThemeSwitch />
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="truncate text-xs text-slate-500">{email}</span>
              <button onClick={logout} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" title="Cerrar sesión">
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </aside>

        {/* Header mobile */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/85 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] backdrop-blur dark:border-slate-800 dark:bg-slate-900/85 lg:hidden">
          <Brand />
          <PrivacyButton hidden={hidden} onClick={toggleHidden} />
        </header>

        <main className="pb-[calc(env(safe-area-inset-bottom)+7.5rem)] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-5 sm:px-6 lg:ml-64 lg:px-10 lg:pb-12 lg:pt-10">
          <div className="mx-auto max-w-6xl">
            {error && (
              <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                Error al cargar datos: {error}
              </div>
            )}
            {ready ? children : <div className="flex justify-center py-24"><Spinner /></div>}
          </div>
        </main>

        {/* Bottom nav mobile */}
        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 lg:hidden">
          <div className="grid grid-cols-5 items-center">
            {NAV.slice(0, 2).map((n) => (
              <BottomLink key={n.href} {...n} active={isActive(n.href)} />
            ))}
            <div className="flex justify-center">
              <button
                onClick={() => openTx()}
                aria-label="Nuevo movimiento"
                className="-mt-7 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-xl shadow-brand-600/30 active:scale-95"
              >
                <Plus size={26} />
              </button>
            </div>
            <BottomLink {...NAV[2]} active={isActive(NAV[2].href)} />
            <button onClick={() => setMenu(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-slate-500">
              <Menu size={20} /> Más
            </button>
          </div>
        </nav>

        {/* Menú "Más" mobile */}
        {menu && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMenu(false)} />
            <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-white p-5 pb-[calc(env(safe-area-inset-bottom)+20px)] dark:bg-slate-900">
              <div className="mb-3 flex items-center justify-between">
                <span className="font-semibold text-slate-900 dark:text-white">Menú</span>
                <button onClick={() => setMenu(false)} className="p-1 text-slate-400"><X size={20} /></button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {NAV.slice(3).map(({ href, label, icon: Icon }) => (
                  <Link key={href} href={href} onClick={() => setMenu(false)}
                    className="flex flex-col items-center gap-1.5 rounded-2xl bg-slate-50 py-4 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    <Icon size={20} /> {label}
                  </Link>
                ))}
              </div>
              <div className="mt-4"><ThemeSwitch /></div>
              <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-4 dark:border-slate-800">
                <span className="truncate text-xs text-slate-500">{email}</span>
                <button onClick={logout} className="flex items-center gap-2 text-sm font-medium text-red-600"><LogOut size={16} /> Salir</button>
              </div>
            </div>
          </div>
        )}

        <TxModal open={txOpen} onClose={() => setTxOpen(false)} initial={editing} />
      </div>
    </QuickCtx.Provider>
  );
}

function PrivacyButton({ hidden, onClick }: { hidden: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={hidden}
      aria-label={hidden ? "Mostrar montos" : "Ocultar montos"}
      title={hidden ? "Mostrar montos" : "Ocultar montos"}
      className={cx(
        "rounded-xl p-2 transition",
        hidden
          ? "bg-brand-50 text-brand-700 dark:bg-brand-600/20 dark:text-brand-100"
          : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800",
      )}
    >
      {hidden ? <EyeOff size={20} /> : <Eye size={20} />}
    </button>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-1">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-md shadow-brand-600/30">
        <Wallet size={18} />
      </span>
      <span className="text-[17px] font-bold tracking-tight text-slate-900 dark:text-white">Mis Finanzas</span>
    </Link>
  );
}

function BottomLink({ href, label, icon: Icon, active }: { href: string; label: string; icon: typeof Plus; active: boolean }) {
  return (
    <Link href={href} className={cx("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", active ? "text-brand-600" : "text-slate-500")}>
      <Icon size={20} /> {label}
    </Link>
  );
}

function ThemeSwitch() {
  const { theme: t, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const theme = mounted ? t : undefined;
  const opts = [
    { v: "light", icon: Sun, l: "Claro" },
    { v: "dark", icon: Moon, l: "Oscuro" },
    { v: "system", icon: Monitor, l: "Auto" },
  ];
  return (
    <div className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
      {opts.map(({ v, icon: Icon, l }) => (
        <button key={v} onClick={() => setTheme(v)} title={l}
          className={cx("flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium",
            theme === v ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white" : "text-slate-500")}>
          <Icon size={14} /> {l}
        </button>
      ))}
    </div>
  );
}
