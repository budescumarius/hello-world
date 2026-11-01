"use client";
import {
  BotIcon, BriefcaseIcon, Building2Icon, CheckSquareIcon, EuroIcon, FileTextIcon, HardHatIcon, LayoutDashboardIcon,
  MenuIcon, SettingsIcon, ShieldCheckIcon, TruckIcon, UsersIcon, XIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";

export interface NavItem { href: string; label: string; icon: keyof typeof ICONS; badge?: number }
const ICONS = {
  dashboard: LayoutDashboardIcon, projects: BriefcaseIcon, financial: EuroIcon, clients: Building2Icon, suppliers: TruckIcon,
  subcontractors: HardHatIcon, employees: UsersIcon, tasks: CheckSquareIcon, documents: FileTextIcon, assistant: BotIcon,
  approvals: ShieldCheckIcon, settings: SettingsIcon,
};

function Links({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Navigation principale">
      {items.map((it) => {
        const Icon = ICONS[it.icon];
        const active = path === it.href || path.startsWith(it.href + "/");
        return (
          <Link key={it.href} href={it.href} onClick={onNavigate}
            className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              active ? "bg-sidebar-accent text-white" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-white")}
            aria-current={active ? "page" : undefined}>
            <Icon className="size-4 shrink-0" />
            <span className="truncate">{it.label}</span>
            {it.badge ? <span className="ml-auto rounded-full bg-critical px-1.5 text-[10px] font-semibold text-white">{it.badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function Sidebar({ items, footer }: { items: NavItem[]; footer: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <aside className="hidden lg:flex w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground h-dvh sticky top-0 p-3">
        <div className="px-3 py-3 text-base font-bold tracking-wide text-white">MADIBU <span className="font-normal text-sidebar-muted">AI</span></div>
        <div className="flex-1 overflow-y-auto"><Links items={items} /></div>
        <div className="border-t border-white/10 pt-3">{footer}</div>
      </aside>
      <header className="lg:hidden sticky top-0 z-40 flex items-center justify-between bg-sidebar px-4 py-3 text-white">
        <span className="font-bold tracking-wide">MADIBU <span className="font-normal text-sidebar-muted">AI</span></span>
        <button onClick={() => setOpen(true)} aria-label="Ouvrir le menu" className="p-1"><MenuIcon className="size-5" /></button>
      </header>
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="w-72 max-w-[85vw] bg-sidebar p-3 text-sidebar-foreground flex flex-col">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="font-bold text-white">MADIBU AI</span>
              <button onClick={() => setOpen(false)} aria-label="Fermer le menu"><XIcon className="size-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto"><Links items={items} onNavigate={() => setOpen(false)} /></div>
            <div className="border-t border-white/10 pt-3">{footer}</div>
          </div>
          <button className="flex-1 bg-black/40" aria-label="Fermer" onClick={() => setOpen(false)} />
        </div>
      )}
    </>
  );
}
