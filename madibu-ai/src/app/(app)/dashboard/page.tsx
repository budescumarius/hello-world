import Link from "next/link";
import { ActionButton } from "@/components/app/action-button";
import { CashChart } from "@/components/app/cash-chart";
import { Kpi } from "@/components/app/kpi";
import { PageHeader } from "@/components/app/page-header";
import { RunAnalysisButton } from "@/components/app/run-analysis-button";
import { SeverityBadge } from "@/components/app/severity";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { loadCompanyData } from "@/lib/data/company";
import { formatDate, todayBrussels } from "@/lib/dates";
import { allForecasts, companySummary, isActive, obligationOccurrences, payables, projectFinancials, receivables } from "@/lib/domain/finance";
import { env } from "@/lib/env";
import { getMessages } from "@/lib/i18n";
import { formatEur, formatPct, sum } from "@/lib/money";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { acknowledgeAlert } from "../_actions";

export const metadata = { title: "Tableau de bord" };

export default async function DashboardPage() {
  const user = await requireUser();
  const t = getMessages(user.locale);
  const sb = await createClient();
  const today = todayBrussels();
  const data = await loadCompanyData(sb);
  const finance = can(user.role, "finance.view");
  const s = companySummary(data, today);
  const eur = (c: number | null) => formatEur(c, { digits: 0, locale: user.locale });

  const [{ data: alerts }, { data: lastRun }, { data: report }] = await Promise.all([
    sb.from("alerts").select("id, severity, title, why, recommendation, responsible, due_date, project_id, status").neq("status", "resolved")
      .order("severity", { ascending: true }).order("impact_amount", { ascending: false, nullsFirst: false }).limit(12),
    sb.from("ai_runs").select("finished_at, status, output_summary").eq("kind", "analysis").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    finance ? sb.from("reports").select("id, report_date").eq("kind", "daily_financial").order("report_date", { ascending: false }).limit(1).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const openTasks = data.tasks.filter((x) => ["todo", "in_progress", "waiting"].includes(x.status));
  const overdueTasks = openTasks.filter((x) => x.due_date && x.due_date < today);
  const active = data.projects.filter(isActive);
  const fc = finance ? allForecasts(data, today) : null;
  const chart = fc ? fc.realistic.weekly.map((w, i) => ({
    week: formatDate(w.weekStart, user.locale).slice(0, 5),
    optimistic: fc.optimistic.weekly[i].closing === null ? null : fc.optimistic.weekly[i].closing! / 100,
    realistic: w.closing === null ? null : w.closing / 100,
    pessimistic: fc.pessimistic.weekly[i].closing === null ? null : fc.pessimistic.weekly[i].closing! / 100,
  })) : [];
  const overdueInv = finance ? receivables(data, today).filter((r) => r.daysOverdue > 0).slice(0, 6) : [];
  const upcoming = finance ? [
    ...payables(data, today).filter((p) => !p.disputed && p.due_date <= addDaysStr(today, 14)).map((p) => ({ date: p.due_date, label: p.number, amount: p.open, overdue: p.daysOverdue > 0 })),
    ...obligationOccurrences(data.obligations, today, addDaysStr(today, 14), true).map((o) => ({ date: o.date, label: o.label, amount: o.amount, overdue: o.overdue })),
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8) : [];
  const sev = t.severity as Record<string, string>;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={t.dashboard.title}
        description={<>{t.dashboard.lastRun} : {lastRun?.finished_at ? `${new Date(lastRun.finished_at).toLocaleString(user.locale === "ro" ? "ro-RO" : "fr-BE", { timeZone: "Europe/Brussels" })} – ${lastRun.output_summary ?? lastRun.status}` : t.dashboard.never}</>}
        actions={can(user.role, "analysis.run") ? <RunAnalysisButton label={t.dashboard.runAnalysis} /> : null} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi testId="kpi-active" label={t.dashboard.activeProjects} value={s.activeProjects} sub={`${t.dashboard.signedValue} ${eur(s.signedContractValue)}${s.unknownContractValues ? ` · ⚠ ${s.unknownContractValues} ${t.dashboard.unknownContracts}` : ""}`} />
        {finance ? <>
          <Kpi testId="kpi-cash" label={t.dashboard.cash} value={s.bank.known ? eur(s.bank.balance) : "—"} tone={s.bank.known ? undefined : "warn"}
            sub={s.bank.known ? `${t.common.manualEntry} · ${formatDate(s.bank.asOf, user.locale)}${(s.bank.ageDays ?? 0) > 7 ? " ⚠" : ""}` : t.dashboard.cashUnknown} />
          <Kpi testId="kpi-invoiced" label={t.dashboard.invoiced} value={eur(s.revenueInvoicedExcl)} sub={`${t.dashboard.collected} : ${eur(s.cashCollected)}`} />
          <Kpi testId="kpi-receivables" label={t.dashboard.receivables} value={eur(s.receivablesOpen)} tone={s.receivablesOverdue > 0 ? "neg" : undefined}
            sub={`${eur(s.receivablesOverdue)} ${t.dashboard.overdue} (${s.overdueInvoiceCount})`} />
          <Kpi testId="kpi-payables" label={t.dashboard.payables} value={eur(s.payablesOpen)} sub={`${eur(s.payablesOverdue)} ${t.dashboard.overdue}`} />
          <Kpi testId="kpi-costs" label={t.dashboard.costsIncurred} value={eur(s.costsIncurred)} sub={`${t.dashboard.costsPaid} : ${eur(s.costsPaid)}`} />
        </> : null}
        <Kpi testId="kpi-tasks" label={t.dashboard.openTasks} value={openTasks.length} tone={overdueTasks.length ? "neg" : undefined} sub={`${overdueTasks.length} ${t.dashboard.overdueTasks}`} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader><CardTitle>{t.dashboard.alerts}</CardTitle><Link href="/tasks" className="text-xs text-muted-foreground underline">{t.nav.tasks}</Link></CardHeader>
          <CardContent>
            {!alerts?.length ? <p className="text-sm text-muted-foreground">{t.dashboard.noAlerts}</p> : (
              <ul className="divide-y" data-testid="alerts">
                {alerts.map((a) => (
                  <li key={a.id} className="flex gap-3 py-2.5">
                    <SeverityBadge severity={a.severity} label={sev[a.severity]} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{a.project_id ? <Link className="hover:underline" href={`/projects/${a.project_id}`}>{a.title}</Link> : a.title}</div>
                      {a.why ? <div className="text-xs text-muted-foreground">{a.why}</div> : null}
                      <div className="mt-0.5 text-xs">➜ {a.recommendation} <span className="text-muted-foreground">· {a.responsible}{a.due_date ? ` · ${formatDate(a.due_date, user.locale)}` : ""}</span></div>
                    </div>
                    {a.status === "open" ? <ActionButton action={acknowledgeAlert.bind(null, a.id)} variant="ghost">✓</ActionButton> : <Badge variant="outline">vu</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        {finance ? (
          <Card className="xl:col-span-2">
            <CardHeader><CardTitle>{t.dashboard.forecast}</CardTitle>
              {report ? <Link href={`/financial/reports/${report.id}`} className="text-xs text-muted-foreground underline">{t.dashboard.latestReport}</Link> : null}</CardHeader>
            <CardContent>
              {s.bank.known ? <CashChart data={chart} threshold={env.cashAlertCents() / 100}
                labels={{ ...t.finance.scenarios, threshold: "seuil" }} /> : <p className="text-sm text-muted-foreground">{t.dashboard.cashUnknown}</p>}
              {fc ? <div className="mt-3 grid grid-cols-3 gap-2 text-xs">{(["optimistic", "realistic", "pessimistic"] as const).map((k) => (
                <div key={k} className="rounded-md border p-2"><div className="text-muted-foreground">{t.finance.scenarios[k]} · 30 j</div>
                  <div className={`font-semibold tabular ${(fc[k].horizons[30].minBalance ?? 0) < 0 ? "text-critical" : ""}`}>{t.finance.minBalance} {eur(fc[k].horizons[30].minBalance)}</div></div>))}
              </div> : null}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Card className="mt-4">
        <CardHeader><CardTitle>{t.dashboard.activeProjects}</CardTitle><Link href="/projects" className="text-xs text-muted-foreground underline">{t.nav.projects}</Link></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-xs text-muted-foreground">
              <th className="py-2 text-left">{t.projects.reference}</th><th className="text-right">{t.projects.progress}</th>
              {finance || can(user.role, "projects.view_all") ? <><th className="text-right">{t.projects.contract}</th><th className="text-right">{t.projects.actualCosts}</th><th className="text-right">{t.projects.grossMargin}</th></> : null}
              <th className="text-right">{t.projects.daysLate}</th></tr></thead>
            <tbody>{active.map((p) => { const f = projectFinancials(p, data, today); return (
              <tr key={p.id} className="border-b last:border-0">
                <td className="py-2"><Link href={`/projects/${p.id}`} className="font-medium hover:underline">{p.reference}</Link><div className="text-xs text-muted-foreground">{p.name}</div></td>
                <td className="text-right tabular">{formatPct(f.progressPct)}</td>
                {finance || can(user.role, "projects.view_all") ? <>
                  <td className="text-right tabular">{eur(f.totalContractExcl)}</td><td className="text-right tabular">{eur(f.costsIncurred)}</td>
                  <td className={`text-right tabular ${(f.estimatedMarginPct ?? 0) < 0 ? "text-critical font-semibold" : ""}`}>{formatPct(f.estimatedMarginPct)}{f.missing.length ? " ⚠" : ""}</td></> : null}
                <td className="text-right">{f.daysLate ? <SeverityBadge severity={f.daysLate > 14 ? "high" : "warning"} label={`${f.daysLate} j`} /> : "—"}</td>
              </tr>); })}</tbody>
          </table>
        </CardContent>
      </Card>

      {finance ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Card><CardHeader><CardTitle>{t.finance.overdueReport}</CardTitle></CardHeader><CardContent>
            {!overdueInv.length ? <p className="text-sm text-muted-foreground">{t.common.none}</p> : <ul className="divide-y text-sm">{overdueInv.map((r) => (
              <li key={r.id} className="flex justify-between gap-2 py-2"><span>{r.number} <span className="text-xs text-muted-foreground">· {data.clients.find((c) => c.id === r.party_id)?.name}</span></span>
                <span className="tabular">{eur(r.open)} <SeverityBadge severity={r.daysOverdue > 60 ? "critical" : r.daysOverdue > 30 ? "high" : "warning"} label={`${r.daysOverdue} j`} /></span></li>))}</ul>}
          </CardContent></Card>
          <Card><CardHeader><CardTitle>{t.finance.upcoming.replace("30", "14")}</CardTitle></CardHeader><CardContent>
            {!upcoming.length ? <p className="text-sm text-muted-foreground">{t.common.none}</p> : <ul className="divide-y text-sm">{upcoming.map((u, i) => (
              <li key={i} className="flex justify-between gap-2 py-2"><span>{formatDate(u.date, user.locale)} · {u.label}{u.overdue ? " ⚠" : ""}</span><span className="tabular">{eur(u.amount)}</span></li>))}</ul>}
            <div className="mt-2 border-t pt-2 text-right text-sm font-semibold tabular">{t.common.total} {eur(sum(upcoming.map((u) => u.amount)))}</div>
          </CardContent></Card>
        </div>
      ) : null}
    </div>
  );
}

function addDaysStr(d: string, n: number) {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
