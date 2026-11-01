import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/app/action-button";
import { DocumentUpload } from "@/components/app/document-upload";
import { Kpi } from "@/components/app/kpi";
import { PageHeader } from "@/components/app/page-header";
import { ProgressForm } from "@/components/app/progress-form";
import { SeverityBadge } from "@/components/app/severity";
import { TaskDialog } from "@/components/app/task-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { loadCompanyData } from "@/lib/data/company";
import { formatDate, todayBrussels } from "@/lib/dates";
import { paidByInvoice, paymentStatus, projectFinancials } from "@/lib/domain/finance";
import { getMessages } from "@/lib/i18n";
import { formatEur, formatPct } from "@/lib/money";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { setProjectArchived, setTaskStatus } from "../../_actions";
import { ChangeOrderDialog } from "./change-order-dialog";
import { ProjectDialog } from "../project-form";

const TABS = ["overview", "financial", "tasks", "documents", "activity"] as const;

export const metadata = { title: "Chantier" };

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const tab = (TABS as readonly string[]).includes(rawTab ?? "") ? (rawTab as (typeof TABS)[number]) : "overview";
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const user = await requireUser();
  const t = getMessages(user.locale);
  const sb = await createClient();
  const today = todayBrussels();
  const { data: row } = await sb.from("projects").select("*, client:clients(name, email, phone), pm:profiles!projects_project_manager_id_fkey(full_name), sm:profiles!projects_site_manager_id_fkey(full_name)").eq("id", id).maybeSingle();
  if (!row) notFound();
  const data = await loadCompanyData(sb);
  const project = data.projects.find((p) => p.id === id)!;
  const f = projectFinancials(project, data, today);
  const eur = (c: number | null) => formatEur(c, { digits: 0, locale: user.locale });
  const eur2 = (c: number | null) => formatEur(c, { locale: user.locale });
  const money = can(user.role, "projects.view_all");
  const canWrite = can(user.role, "projects.write");
  const [{ data: clients }, { data: profiles }] = await Promise.all([
    sb.from("clients").select("id, name").order("name"), sb.from("profiles").select("id, full_name").eq("active", true).order("full_name"),
  ]);
  const profileOpts = (profiles ?? []).map((p) => ({ value: p.id, label: p.full_name }));
  const tp = t.projects;

  return (
    <div className="mx-auto max-w-7xl">
      <Link href="/projects" className="text-xs text-muted-foreground hover:underline">← {t.projects.title}</Link>
      <PageHeader title={`${row.reference} – ${row.name}`}
        description={<span className="flex flex-wrap items-center gap-2"><Badge variant="outline">{t.projectStatus[row.status as keyof typeof t.projectStatus]}</Badge>
          {row.archived_at ? <Badge>{t.common.archived}</Badge> : null}<span>{row.site_address ?? ""}</span></span>}
        actions={canWrite ? <>
          <ProjectDialog t={t} project={{ ...row, ...project, contract_amount_excl: f.contractExcl === null ? null : f.contractExcl / 100,
            budget_materials: cents(project.budget_materials), budget_labour: cents(project.budget_labour), budget_subcontract: cents(project.budget_subcontract),
            budget_other: cents(project.budget_other), forecast_cost_override: cents(project.forecast_cost_override) }}
            clients={(clients ?? []).map((c) => ({ value: c.id, label: c.name }))} profiles={profileOpts} />
          <ActionButton action={setProjectArchived.bind(null, id, !row.archived_at)} confirm={row.archived_at ? undefined : tp.archiveConfirm}>
            {row.archived_at ? t.common.unarchive : t.common.archive}</ActionButton>
        </> : null} />

      {f.missing.length ? <div className="mb-4 rounded-md border border-warning/60 bg-warning/10 px-3 py-2 text-sm">⚠ {tp.missingData} <strong>{f.missing.map((m) => ({ contract_amount: tp.contract, budget: tp.budget, progress: tp.progress, planned_end_date: tp.plannedEnd, client: tp.client } as Record<string, string>)[m] ?? m).join(", ")}</strong></div> : null}

      <nav className="mb-4 flex gap-1 overflow-x-auto border-b" aria-label="Onglets">
        {TABS.filter((x) => x !== "financial" || money).map((x) => (
          <Link key={x} href={`/projects/${id}?tab=${x}`} className={cn("border-b-2 px-3 py-2 text-sm whitespace-nowrap", tab === x ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>{tp.tabs[x]}</Link>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label={tp.progress} value={formatPct(f.progressPct)} sub={`${tp.plannedProgress} ${formatPct(f.plannedProgressPct)} · MAJ ${formatDate(row.progress_updated_at, user.locale)}`} />
            <Kpi label={tp.plannedEnd} value={formatDate(row.planned_end_date, user.locale)} tone={f.daysLate ? "neg" : undefined} sub={f.daysLate ? `${tp.daysLate} ${f.daysLate} j` : `${tp.start} ${formatDate(row.start_date, user.locale)}`} />
            {money ? <>
              <Kpi label={tp.contract} value={eur(f.totalContractExcl)} sub={`${tp.contractTotal} ${f.totalContractExcl !== null && project.vat_rate !== null ? eur(Math.round(f.totalContractExcl * (1 + project.vat_rate / 100))) : "—"}`} />
              <Kpi label={tp.grossMargin} value={formatPct(f.estimatedMarginPct)} tone={(f.estimatedMarginPct ?? 0) < 0 ? "neg" : undefined} sub={`${tp.grossProfit} ${eur(f.estimatedProfit)}`} />
            </> : null}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Card><CardHeader><CardTitle>{t.common.contact}</CardTitle></CardHeader><CardContent className="grid gap-1 text-sm">
              <div><span className="text-muted-foreground">{tp.client} :</span> {row.client?.name ?? "—"} {row.client?.email ?? ""} {row.client?.phone ?? ""}</div>
              <div><span className="text-muted-foreground">{tp.architect} :</span> {row.architect_name ?? "—"} {row.architect_email ?? ""} {row.architect_phone ?? ""}</div>
              <div><span className="text-muted-foreground">{tp.engineer} :</span> {row.engineer_name ?? "—"} {row.engineer_email ?? ""}</div>
              <div><span className="text-muted-foreground">{tp.manager} :</span> {row.pm?.full_name ?? "—"} · <span className="text-muted-foreground">{tp.siteManager} :</span> {row.sm?.full_name ?? "—"}</div>
              {row.notes ? <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{row.notes}</p> : null}
            </CardContent></Card>
            <Card><CardHeader><CardTitle>{tp.progressUpdate}</CardTitle></CardHeader><CardContent className="grid gap-3">
              {can(user.role, "projects.write") || user.role === "site_manager" ? <ProgressForm projectId={id} value={f.progressPct} label={tp.progressUpdate} /> : null}
              <p className="text-xs text-muted-foreground">L&apos;avancement déclaré n&apos;est pas une réception : les travaux sont considérés réalisés uniquement après vérification sur chantier.</p>
            </CardContent></Card>
          </div>
          <Card><CardHeader><CardTitle>{tp.changeOrders}</CardTitle>
            {canWrite ? <ChangeOrderDialog projectId={id} title={tp.changeOrders} descriptionLabel={t.common.description} amountLabel={`${t.common.amount} ${t.common.excl} (€)`} today={today} /> : null}</CardHeader>
            <CardContent>{!data.changeOrders.filter((c) => c.project_id === id).length ? <p className="text-sm text-muted-foreground">{t.common.none}</p> :
              <ul className="divide-y text-sm">{data.changeOrders.filter((c) => c.project_id === id).map((c) => (
                <li key={c.id} className="flex flex-wrap justify-between gap-2 py-2"><span>{c.description} <span className="text-xs text-muted-foreground">· {formatDate(c.requested_on, user.locale)}{c.work_started ? " · travaux commencés" : ""}</span></span>
                  <span className="flex items-center gap-2 tabular">{eur(c.amount_excl)} {c.status === "approved" ? <Badge>accord écrit</Badge> : c.status === "rejected" ? <Badge variant="outline">refusé</Badge> : <SeverityBadge severity={c.work_started ? "high" : "warning"} label="sans accord écrit" />}</span></li>))}</ul>}
            </CardContent></Card>
        </div>
      )}

      {tab === "financial" && money && (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label={tp.contract} value={eur(f.totalContractExcl)} sub={`dont avenants approuvés ${eur(f.approvedChangeOrders)} · en attente ${eur(f.pendingChangeOrders)}`} />
            <Kpi label={`${tp.invoiced} (${t.common.excl})`} value={eur(f.invoicedExcl)} sub={`${t.common.incl} ${eur(f.invoicedTotal)}`} />
            <Kpi label={`${tp.collected} (${t.common.incl})`} value={eur(f.collected)} sub={`${t.finance.outstanding} ${eur(f.outstandingReceivable)}`} />
            <Kpi label={tp.unbilled} value={f.unbilledWork !== null && f.unbilledWork > 0 ? eur(f.unbilledWork) : "—"} sub={`valeur réalisée déclarée ${eur(f.earnedValue)}`} />
            <Kpi label={tp.actualCosts} value={eur(f.costsIncurred)} sub={`payé ${eur(f.costsPaid)} · à payer ${eur(f.unpaidCommitments)}`} />
            <Kpi label={tp.remainingBudget} value={eur(f.remainingBudget)} tone={(f.remainingBudget ?? 0) < 0 ? "neg" : undefined} sub={`${tp.budget} ${eur(f.budgetTotal)} · ${formatPct(f.budgetUsedPct)}`} />
            <Kpi label={tp.forecastCost} value={eur(f.forecastFinalCost)} sub={f.forecastMethod ? tp.method[f.forecastMethod] : "—"} />
            <Kpi label={tp.cashPosition} value={eur(f.cashPosition)} tone={f.cashPosition < 0 ? "neg" : undefined} sub="encaissé − payé (TVAC)" />
          </div>
          <Card><CardHeader><CardTitle>{tp.budget}</CardTitle></CardHeader><CardContent className="overflow-x-auto">
            <table className="w-full text-sm"><thead><tr className="border-b text-xs text-muted-foreground"><th className="py-2 text-left">{t.finance.category}</th><th className="text-right">{tp.budget}</th><th className="text-right">{tp.actualCosts}</th><th className="text-right">Écart</th></tr></thead>
              <tbody>{([["materials", project.budget_materials], ["labour", project.budget_labour], ["subcontract", project.budget_subcontract], ["other", project.budget_other]] as const).map(([k, b]) => (
                <tr key={k} className="border-b last:border-0"><td className="py-2">{t.categories[k]}</td><td className="text-right tabular">{eur(b)}</td><td className="text-right tabular">{eur(f.costs[k])}</td>
                  <td className={`text-right tabular ${b !== null && f.costs[k] > b ? "text-critical font-semibold" : ""}`}>{b === null ? "—" : eur(b - f.costs[k])}</td></tr>))}
                <tr className="text-xs text-muted-foreground"><td className="py-2" colSpan={4}>dont main-d&apos;œuvre interne (paie) : {eur(f.payrollLabour)}</td></tr></tbody></table>
          </CardContent></Card>
          <Card><CardHeader><CardTitle>{t.finance.customerInvoices} / {t.finance.supplierInvoices}</CardTitle></CardHeader><CardContent className="overflow-x-auto">
            <InvoiceTable data={data} projectId={id} t={t} eur={eur2} locale={user.locale} />
          </CardContent></Card>
        </div>
      )}

      {tab === "tasks" && (
        <Card><CardHeader><CardTitle>{t.tasks.title}</CardTitle>{can(user.role, "tasks.write") ? <TaskDialog t={t} projectId={id} projects={[{ value: id, label: row.reference }]} profiles={profileOpts} /> : null}</CardHeader>
          <CardContent><ul className="divide-y text-sm">{data.tasks.filter((x) => x.project_id === id).sort((a, b) => (a.due_date ?? "9").localeCompare(b.due_date ?? "9")).map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className={x.status === "completed" ? "line-through text-muted-foreground" : ""}>{x.title} <span className="text-xs text-muted-foreground">· {t.tasks.status[x.status]} · {formatDate(x.due_date, user.locale)}{x.source === "ai" ? " · IA" : ""}</span></span>
              {x.status !== "completed" ? <ActionButton action={setTaskStatus.bind(null, x.id, "completed")}>✓ {t.tasks.status.completed}</ActionButton> : null}
            </li>))}</ul></CardContent></Card>
      )}

      {tab === "documents" && <ProjectDocuments projectId={id} t={t} canUpload={can(user.role, "documents.write")} locale={user.locale} />}
      {tab === "activity" && <ProjectActivity projectId={id} t={t} locale={user.locale} canAudit={can(user.role, "audit.view")} />}
    </div>
  );
}

const cents = (v: number | null) => (v === null ? null : v / 100);

function InvoiceTable({ data, projectId, t, eur, locale }: { data: Awaited<ReturnType<typeof loadCompanyData>>; projectId: string; t: ReturnType<typeof getMessages>; eur: (c: number | null) => string; locale: string }) {
  const paid = paidByInvoice(data.payments);
  const names = new Map([...data.clients, ...data.suppliers, ...data.subcontractors].map((p) => [p.id, p.name]));
  const rows = data.invoices.filter((i) => i.project_id === projectId).sort((a, b) => a.issue_date.localeCompare(b.issue_date));
  if (!rows.length) return <p className="text-sm text-muted-foreground">{t.common.none}</p>;
  return (
    <table className="w-full text-sm"><thead><tr className="border-b text-xs text-muted-foreground"><th className="py-2 text-left">{t.finance.number}</th><th className="text-left">Tiers</th><th className="text-left">{t.finance.dueDate}</th><th className="text-right">{t.common.excl}</th><th className="text-right">{t.common.incl}</th><th className="text-right">{t.finance.paid}</th><th className="pl-3 text-left">{t.common.status}</th></tr></thead>
      <tbody>{rows.map((i) => { const p = paid.get(i.id) ?? 0; const st = paymentStatus(i.amount_total, p); return (
        <tr key={i.id} className="border-b last:border-0"><td className="py-2">{i.direction === "issued" ? "↗" : "↙"} {i.number}<div className="text-xs text-muted-foreground">{t.finance.kind[i.kind]}</div></td>
          <td>{names.get(i.client_id ?? i.supplier_id ?? i.subcontractor_id ?? "") ?? "—"}</td><td>{formatDate(i.due_date, locale)}</td>
          <td className="text-right tabular">{eur(i.amount_excl)}</td><td className="text-right tabular">{eur(i.amount_total)}</td><td className="text-right tabular">{eur(p)}</td>
          <td className="pl-3"><Badge variant="outline">{i.status === "disputed" || i.status === "cancelled" || i.status === "draft" ? t.finance.invoiceStatus[i.status] : t.finance.paymentStatus[st]}</Badge></td></tr>); })}</tbody></table>
  );
}

async function ProjectDocuments({ projectId, t, canUpload, locale }: { projectId: string; t: ReturnType<typeof getMessages>; canUpload: boolean; locale: string }) {
  const sb = await createClient();
  const { data: docs } = await sb.from("documents").select("id, name, category, size_bytes, created_at").eq("project_id", projectId).order("created_at", { ascending: false });
  return (
    <Card><CardHeader><CardTitle>{t.documents.title}</CardTitle></CardHeader><CardContent className="grid gap-4">
      {canUpload ? <DocumentUpload projectId={projectId} categories={t.documents.categories} label={t.documents.upload} /> : null}
      {!docs?.length ? <p className="text-sm text-muted-foreground">{t.common.none}</p> : <ul className="divide-y text-sm">{docs.map((d) => (
        <li key={d.id} className="flex justify-between gap-2 py-2"><a className="hover:underline" href={`/api/documents/${d.id}`}>{d.name}</a>
          <span className="text-xs text-muted-foreground">{t.documents.categories[d.category as keyof typeof t.documents.categories]} · {Math.ceil((d.size_bytes ?? 0) / 1024)} Ko · {formatDate(d.created_at, locale)}</span></li>))}</ul>}
    </CardContent></Card>
  );
}

async function ProjectActivity({ projectId, t, locale, canAudit }: { projectId: string; t: ReturnType<typeof getMessages>; locale: string; canAudit: boolean }) {
  const sb = await createClient();
  const [{ data: alerts }, { data: logs }] = await Promise.all([
    sb.from("alerts").select("id, severity, title, status, first_seen_at, resolved_at").eq("project_id", projectId).order("first_seen_at", { ascending: false }).limit(50),
    canAudit ? sb.from("audit_logs").select("id, created_at, actor_type, action, table_name").or(`record_id.eq.${projectId},new_data->>project_id.eq.${projectId}`).order("created_at", { ascending: false }).limit(100) : Promise.resolve({ data: [] as never[] }),
  ]);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card><CardHeader><CardTitle>Alertes (historique)</CardTitle></CardHeader><CardContent><ul className="divide-y text-sm">{(alerts ?? []).map((a) => (
        <li key={a.id} className="flex gap-2 py-2"><SeverityBadge severity={a.severity} label={t.severity[a.severity as keyof typeof t.severity]} /><span className="flex-1">{a.title}<div className="text-xs text-muted-foreground">{formatDate(a.first_seen_at, locale)} · {a.status}{a.resolved_at ? ` → ${formatDate(a.resolved_at, locale)}` : ""}</div></span></li>))}</ul></CardContent></Card>
      <Card><CardHeader><CardTitle>{t.settings.audit}</CardTitle></CardHeader><CardContent>{!canAudit ? <p className="text-sm text-muted-foreground">Réservé à l&apos;OWNER et à l&apos;ADMIN.</p> :
        <ul className="divide-y text-xs">{(logs ?? []).map((l) => <li key={l.id} className="py-1.5">{new Date(l.created_at).toLocaleString(locale === "ro" ? "ro-RO" : "fr-BE", { timeZone: "Europe/Brussels" })} · {l.actor_type} · {l.action} · {l.table_name}</li>)}</ul>}</CardContent></Card>
    </div>
  );
}
