import { LogOutIcon } from "lucide-react";
import { Sidebar, type NavItem } from "@/components/app/nav";
import { requireUser } from "@/lib/auth";
import { getMessages } from "@/lib/i18n";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { logout } from "../login/actions";
import { LocaleSwitch } from "./locale-switch";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const t = getMessages(user.locale);
  let pending = 0;
  if (can(user.role, "approvals.view")) {
    const sb = await createClient();
    const { count } = await sb.from("approvals").select("id", { count: "exact", head: true }).eq("status", "pending");
    pending = count ?? 0;
  }
  const all: Array<NavItem & { show: boolean }> = [
    { href: "/dashboard", label: t.nav.dashboard, icon: "dashboard", show: true },
    { href: "/projects", label: t.nav.projects, icon: "projects", show: true },
    { href: "/financial", label: t.nav.financial, icon: "financial", show: can(user.role, "finance.view") },
    { href: "/clients", label: t.nav.clients, icon: "clients", show: can(user.role, "parties.view") },
    { href: "/suppliers", label: t.nav.suppliers, icon: "suppliers", show: can(user.role, "parties.view") },
    { href: "/subcontractors", label: t.nav.subcontractors, icon: "subcontractors", show: can(user.role, "parties.view") },
    { href: "/employees", label: t.nav.employees, icon: "employees", show: can(user.role, "employees.view") },
    { href: "/tasks", label: t.nav.tasks, icon: "tasks", show: true },
    { href: "/documents", label: t.nav.documents, icon: "documents", show: can(user.role, "documents.view") },
    { href: "/assistant", label: t.nav.assistant, icon: "assistant", show: can(user.role, "assistant.use") },
    { href: "/approvals", label: t.nav.approvals, icon: "approvals", show: can(user.role, "approvals.view"), badge: pending },
    { href: "/settings", label: t.nav.settings, icon: "settings", show: true },
  ];
  const items: NavItem[] = all.filter((i) => i.show).map((i) => ({ href: i.href, label: i.label, icon: i.icon, badge: i.badge }));
  const footer = (
    <div className="grid gap-2 px-2 text-xs text-sidebar-muted">
      <div className="truncate text-sidebar-foreground">{user.fullName}</div>
      <div>{t.roles[user.role]}</div>
      <LocaleSwitch locale={user.locale} />
      <form action={logout}>
        <button className="flex items-center gap-2 text-sidebar-foreground/80 hover:text-white" type="submit"><LogOutIcon className="size-3.5" />{t.nav.logout}</button>
      </form>
    </div>
  );
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <Sidebar items={items} footer={footer} />
      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
    </div>
  );
}
