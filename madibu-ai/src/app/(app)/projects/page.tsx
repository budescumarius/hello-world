import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { SeverityBadge } from "@/components/app/severity";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { loadCompanyData } from "@/lib/data/company";
import { formatDate, todayBrussels } from "@/lib/dates";
import { projectFinancials } from "@/lib/domain/finance";
import { getMessages } from "@/lib/i18n";
import { formatEur, formatPct } from "@/lib/money";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { ProjectDialog } from "./project-form";

export const metadata = { title: "Chantiers" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ status?: string; archived?: string; q?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const t = getMessages(user.locale);
  const sb = await createClient();
  const today = todayBrussels();
  const data = await loadCompanyData(sb);
  const showMoney = can(user.role, "projects.view_all");
  const [{ data: clients }, { data: profiles }] = await Promise.all([
    sb.from("clients").select("id, name").is("archived_at", null).order("name"),
    sb.from("profiles").select("id, full_name, role").eq("active", true).order("full_name"),
  ]);
  const q = (sp.q ?? "").toLowerCase();
  const list = data.projects
    .filter((p) => (sp.archived === "1" ? !!p.archived_at : !p.archived_at))
    .filter((p) => !sp.status || p.status === sp.status)
    .filter((p) => !q || `${p.reference} ${p.name} ${p.site_address ?? ""}`.toLowerCase().includes(q))
    .sort((a, b) => b.reference.localeCompare(a.reference));
  const clientName = new Map(data.clients.map((c) => [c.id, c.name]));
  const eur = (c: number | null) => formatEur(c, { digits: 0, locale: user.locale });

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={t.projects.title} actions={<>
        {can(user.role, "export.run") ? <a className="inline-flex h-9 items-center rounded-md border bg-card px-3 text-sm" href="/api/export/projects">{t.common.export}</a> : null}
        {can(user.role, "projects.write") ? <ProjectDialog t={t} clients={(clients ?? []).map((c) => ({ value: c.id, label: c.name }))}
          profiles={(profiles ?? []).map((p) => ({ value: p.id, label: `${p.full_name} (${t.roles[p.role as keyof typeof t.roles]})` }))} /> : null}
      </>} />
      <form className="mb-4 flex flex-wrap gap-2 text-sm">
        <input name="q" defaultValue={sp.q} placeholder={t.common.search} className="h-9 rounded-md border bg-card px-3" />
        <select name="status" defaultValue={sp.status ?? ""} className="h-9 rounded-md border bg-card px-2">
          <option value="">{t.common.all}</option>
          {Object.entries(t.projectStatus).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="flex items-center gap-1.5"><input type="checkbox" name="archived" value="1" defaultChecked={sp.archived === "1"} /> {t.common.showArchived}</label>
        <button className="h-9 rounded-md border bg-card px-3">OK</button>
      </form>
      <Card><CardContent className="overflow-x-auto">
        {!list.length ? <p className="text-sm text-muted-foreground">{t.common.none}</p> : (
          <table className="w-full text-sm" data-testid="projects-table">
            <thead><tr className="border-b text-xs text-muted-foreground">
              <th className="py-2 text-left">{t.projects.reference}</th><th className="text-left">{t.projects.client}</th><th className="text-left">{t.common.status}</th>
              <th className="text-right">{t.projects.progress}</th><th className="text-left">{t.projects.plannedEnd}</th>
              {showMoney ? <><th className="text-right">{t.projects.contract}</th><th className="text-right">{t.projects.invoiced}</th><th className="text-right">{t.projects.collected}</th><th className="text-right">{t.projects.grossMargin}</th></> : null}
            </tr></thead>
            <tbody>{list.map((p) => { const f = projectFinancials(p, data, today); return (
              <tr key={p.id} className="border-b last:border-0 hover:bg-muted/40">
                <td className="py-2"><Link className="font-medium hover:underline" href={`/projects/${p.id}`}>{p.reference}</Link><div className="text-xs text-muted-foreground">{p.name}</div></td>
                <td>{clientName.get(p.client_id ?? "") ?? "—"}</td>
                <td><Badge variant="outline">{t.projectStatus[p.status]}</Badge>{p.archived_at ? <Badge className="ml-1">{t.common.archived}</Badge> : null}</td>
                <td className="text-right tabular">{formatPct(f.progressPct)}</td>
                <td>{formatDate(p.planned_end_date, user.locale)}{f.daysLate ? <> <SeverityBadge severity="high" label={`+${f.daysLate} j`} /></> : null}</td>
                {showMoney ? <>
                  <td className="text-right tabular">{eur(f.totalContractExcl)}</td><td className="text-right tabular">{eur(f.invoicedExcl)}</td>
                  <td className="text-right tabular">{eur(f.collected)}</td>
                  <td className={`text-right tabular ${(f.estimatedMarginPct ?? 0) < 0 ? "font-semibold text-critical" : ""}`}>{formatPct(f.estimatedMarginPct)}{f.missing.length ? " ⚠" : ""}</td></> : null}
              </tr>); })}</tbody>
          </table>)}
      </CardContent></Card>
    </div>
  );
}
