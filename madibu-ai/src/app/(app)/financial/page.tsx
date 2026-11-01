import Link from "next/link";
import { Kpi } from "@/components/app/kpi";
import { PageHeader } from "@/components/app/page-header";
import { RunAnalysisButton } from "@/components/app/run-analysis-button";
import { SeverityBadge } from "@/components/app/severity";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth";
import { loadCompanyData } from "@/lib/data/company";
import { formatDate, todayBrussels } from "@/lib/dates";
import {
  AGING_BUCKETS, aging, allForecasts, bankPosition, COMMON_RULES, HORIZONS, isActive, obligationOccurrences, paidByExpense, paidByInvoice,
  payables, paymentStatus, projectFinancials, receivables, SCENARIO_RULES, SCENARIOS,
} from "@/lib/domain/finance";
import { getMessages } from "@/lib/i18n";
import { formatEur, formatPct, sum } from "@/lib/money";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import {
  BankBalanceDialog, ConfirmObligation, ExpenseDialog, IssuedInvoiceDialog, ObligationDialog, PaymentDialog, ReceivedInvoiceDialog,
} from "./forms";

export const metadata = { title: "Finances" };
const TABS = ["overview", "customer", "supplier", "expenses", "payments", "forecast", "obligations"] as const;
type Tab = (typeof TABS)[number];
const AGING_LABELS: Record<string, string> = { not_due: "Non échu", d1_30: "1–30 j", d31_60: "31–60 j", d61_90: "61–90 j", d90_plus: "> 90 j" };

export default async function FinancialPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "overview";
  const user = await requirePermission("finance.view");
  const t = getMessages(user.locale);
  const sb = await createClient();
  const today = todayBrussels();
  const data = await loadCompanyData(sb);
  const write = can(user.role, "finance.write");
  const eur = (c: number | null) => formatEur(c, { locale: user.locale });
  const eur0 = (c: number | null) => formatEur(c, { digits: 0, locale: user.locale });
  const fd = (d: string | null) => formatDate(d, user.locale);
  const names = new Map([...data.clients, ...data.suppliers, ...data.subcontractors].map((p) => [p.id, p.name]));
  const projects = new Map(data.projects.map((p) => [p.id, p]));
  const projectOpts = data.projects.filter((p) => !p.archived_at).map((p) => ({ value: p.id, label: `${p.reference} ${p.name}` }));
  const labels: Record<Tab, string> = { overview: t.finance.overview, customer: t.finance.customerInvoices, supplier: t.finance.supplierInvoices,
    expenses: t.finance.expenses, payments: t.finance.payments, forecast: t.finance.forecast, obligations: `${t.finance.obligations} · ${t.finance.bank}` };
  const paidI = paidByInvoice(data.payments);
  const paidE = paidByExpense(data.payments);
  const { data: employees } = await sb.from("employees").select("id, full_name").eq("active", true).order("full_name");
  const { data: lastReport } = await sb.from("reports").select("id, report_date").eq("kind", "daily_financial").order("report_date", { ascending: false }).limit(1).maybeSingle();

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={t.finance.title} description="Rentabilité en HTVA · trésorerie en TVAC · un montant est « payé » uniquement si le paiement est enregistré."
        actions={<>
          {lastReport ? <Link className="inline-flex h-9 items-center rounded-md border bg-card px-3 text-sm" href={`/financial/reports/${lastReport.id}`}>{t.reports.daily} ({fd(lastReport.report_date)})</Link> : null}
          <a className="inline-flex h-9 items-center rounded-md border bg-card px-3 text-sm" href="/api/export/financial">{t.common.export}</a>
          {can(user.role, "analysis.run") ? <RunAnalysisButton label={t.dashboard.runAnalysis} /> : null}
        </>} />
      <nav className="mb-4 flex gap-1 overflow-x-auto border-b">
        {TABS.map((x) => <Link key={x} href={`/financial?tab=${x}`} className={cn("border-b-2 px-3 py-2 text-sm whitespace-nowrap", tab === x ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>{labels[x]}</Link>)}
      </nav>

      {tab === "overview" && (() => {
        const rec = receivables(data, today), pay = payables(data, today);
        const ra = aging(rec), pa = aging(pay);
        const active = data.projects.filter((p) => isActive(p) || p.status === "completed");
        return (
          <div className="grid gap-4">
            <Card><CardHeader><CardTitle>{t.finance.profitability}</CardTitle></CardHeader><CardContent className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="profitability"><thead><tr className="border-b text-xs text-muted-foreground">
                <th className="py-2 text-left">{t.common.project}</th><th className="text-right">{t.projects.contract}</th><th className="text-right">{t.projects.invoiced}</th>
                <th className="text-right">{t.projects.collected}</th><th className="text-right">{t.categories.materials}</th><th className="text-right">{t.categories.labour}</th>
                <th className="text-right">{t.categories.subcontract}</th><th className="text-right">{t.categories.other}</th><th className="text-right">{t.projects.remainingBudget}</th>
                <th className="text-right">{t.projects.grossProfit}</th><th className="text-right">{t.projects.grossMargin}</th></tr></thead>
                <tbody>{active.map((p) => { const f = projectFinancials(p, data, today); return (
                  <tr key={p.id} className="border-b last:border-0"><td className="py-2"><Link className="hover:underline" href={`/projects/${p.id}?tab=financial`}>{p.reference}</Link>{f.missing.length ? <span title={f.missing.join(", ")}> ⚠</span> : null}</td>
                    <td className="text-right tabular">{eur0(f.totalContractExcl)}</td><td className="text-right tabular">{eur0(f.invoicedExcl)}</td><td className="text-right tabular">{eur0(f.collected)}</td>
                    <td className="text-right tabular">{eur0(f.costs.materials)}</td><td className="text-right tabular">{eur0(f.costs.labour)}</td><td className="text-right tabular">{eur0(f.costs.subcontract)}</td>
                    <td className="text-right tabular">{eur0(f.costs.other)}</td><td className={cn("text-right tabular", (f.remainingBudget ?? 0) < 0 && "text-critical")}>{eur0(f.remainingBudget)}</td>
                    <td className={cn("text-right tabular", (f.estimatedProfit ?? 0) < 0 && "text-critical font-semibold")}>{eur0(f.estimatedProfit)}</td>
                    <td className={cn("text-right tabular", (f.estimatedMarginPct ?? 0) < 0 && "text-critical font-semibold")}>{formatPct(f.estimatedMarginPct)}</td></tr>); })}</tbody></table>
              <p className="mt-2 text-xs text-muted-foreground">⚠ = données manquantes : l&apos;indicateur concerné n&apos;est pas calculé. Coût final estimé : prévision manuelle, sinon tendance (coûts ÷ avancement déclaré), sinon budget.</p>
            </CardContent></Card>
            <div className="grid gap-4 md:grid-cols-2">
              {[["Créances clients", ra, rec], ["Dettes fournisseurs & sous-traitants", pa, pay]].map(([title, ag, items]) => (
                <Card key={title as string}><CardHeader><CardTitle>{t.finance.aging} – {title as string}</CardTitle></CardHeader><CardContent>
                  <div className="grid grid-cols-5 gap-2 text-center text-xs">{AGING_BUCKETS.map((b) => (
                    <div key={b} className="rounded-md border p-2"><div className="text-muted-foreground">{AGING_LABELS[b]}</div><div className={cn("mt-1 font-semibold tabular", b !== "not_due" && (ag as Record<string, number>)[b] > 0 && "text-critical")}>{eur0((ag as Record<string, number>)[b])}</div></div>))}</div>
                  <div className="mt-2 text-right text-sm font-semibold tabular">{t.common.total} {eur0(sum((items as Array<{ open: number }>).map((i) => i.open)))}</div>
                </CardContent></Card>))}
            </div>
          </div>
        );
      })()}

      {tab === "customer" && (
        <Card><CardHeader><CardTitle>{t.finance.customerInvoices}</CardTitle>{write ? <IssuedInvoiceDialog t={t} clients={data.clients.map((c) => ({ value: c.id, label: c.name }))} projects={projectOpts} /> : null}</CardHeader>
          <CardContent className="overflow-x-auto"><table className="w-full text-sm" data-testid="issued-invoices"><thead><tr className="border-b text-xs text-muted-foreground">
            <th className="py-2 text-left">{t.finance.number}</th><th className="text-left">{t.projects.client}</th><th className="text-left">{t.common.project}</th>
            <th className="text-right">{t.common.excl}</th><th className="text-right">{t.common.vat}</th><th className="text-right">{t.common.total}</th>
            <th className="text-left pl-3">{t.finance.issueDate}</th><th className="text-left">{t.finance.dueDate}</th><th className="text-right">{t.finance.paid}</th>
            <th className="text-right">{t.finance.outstanding}</th><th className="pl-3 text-left">{t.common.status}</th><th /></tr></thead>
            <tbody>{data.invoices.filter((i) => i.direction === "issued").sort((a, b) => b.issue_date.localeCompare(a.issue_date)).map((i) => {
              const p = paidI.get(i.id) ?? 0, open = i.amount_total - p, late = open > 0 && i.due_date < today && i.status === "issued";
              return (<tr key={i.id} className="border-b last:border-0"><td className="py-2 font-medium">{i.number}<div className="text-xs font-normal text-muted-foreground">{t.finance.kind[i.kind]}</div></td>
                <td>{names.get(i.client_id ?? "") ?? "—"}</td><td>{projects.get(i.project_id ?? "")?.reference ?? "—"}</td>
                <td className="text-right tabular">{eur(i.amount_excl)}</td><td className="text-right tabular">{eur(i.vat_amount)}</td><td className="text-right tabular">{eur(i.amount_total)}</td>
                <td className="pl-3">{fd(i.issue_date)}</td><td>{fd(i.due_date)}</td><td className="text-right tabular">{eur(p)}</td><td className="text-right tabular font-medium">{eur(open)}</td>
                <td className="pl-3">{["draft", "cancelled", "disputed"].includes(i.status) ? <Badge variant="outline">{t.finance.invoiceStatus[i.status]}</Badge>
                  : late ? <SeverityBadge severity="high" label={`${t.finance.paymentStatus[paymentStatus(i.amount_total, p)]} · retard`} /> : <Badge variant="outline">{t.finance.paymentStatus[paymentStatus(i.amount_total, p)]}</Badge>}</td>
                <td className="text-right">{write && open > 0 && i.kind !== "credit_note" && ["issued", "disputed"].includes(i.status) ? <PaymentDialog t={t} direction="in" invoiceId={i.id} open={open} label={i.number} /> : null}</td></tr>);
            })}</tbody></table></CardContent></Card>
      )}

      {tab === "supplier" && (
        <Card><CardHeader><CardTitle>{t.finance.supplierInvoices}</CardTitle>{write ? <ReceivedInvoiceDialog t={t} projects={projectOpts}
          parties={[...data.suppliers.map((s) => ({ value: `supplier:${s.id}`, label: `${s.name} (fournisseur)` })), ...data.subcontractors.map((s) => ({ value: `subcontractor:${s.id}`, label: `${s.name} (sous-traitant)` }))]} /> : null}</CardHeader>
          <CardContent className="overflow-x-auto"><table className="w-full text-sm" data-testid="received-invoices"><thead><tr className="border-b text-xs text-muted-foreground">
            <th className="py-2 text-left">{t.finance.supplier}</th><th className="text-left">{t.finance.number}</th><th className="text-left">{t.common.project}</th><th className="text-left">{t.finance.category}</th>
            <th className="text-right">{t.common.total}</th><th className="pl-3 text-left">{t.finance.dueDate}</th><th className="text-right">{t.finance.paid}</th><th className="text-right">{t.finance.outstanding}</th><th className="pl-3 text-left">{t.common.status}</th><th /></tr></thead>
            <tbody>{data.invoices.filter((i) => i.direction === "received").sort((a, b) => a.due_date.localeCompare(b.due_date)).map((i) => {
              const p = paidI.get(i.id) ?? 0, open = i.amount_total - p;
              return (<tr key={i.id} className="border-b last:border-0"><td className="py-2">{names.get(i.supplier_id ?? i.subcontractor_id ?? "") ?? "—"}{i.subcontractor_id ? <span className="text-xs text-muted-foreground"> · ST</span> : null}</td>
                <td>{i.number}</td><td>{projects.get(i.project_id ?? "")?.reference ?? <span className="text-muted-foreground">frais généraux</span>}</td><td>{t.categories[i.cost_category ?? "other"]}</td>
                <td className="text-right tabular">{eur(i.amount_total)}</td><td className="pl-3">{fd(i.due_date)}{open > 0 && i.due_date < today && i.status !== "cancelled" ? " ⚠" : ""}</td>
                <td className="text-right tabular">{eur(p)}</td><td className="text-right tabular font-medium">{eur(open)}</td>
                <td className="pl-3"><Badge variant="outline">{i.status === "disputed" || i.status === "cancelled" ? t.finance.invoiceStatus[i.status] : t.finance.paymentStatus[paymentStatus(i.amount_total, p)]}</Badge></td>
                <td className="text-right">{write && open > 0 && !["cancelled", "disputed"].includes(i.status) ? <PaymentDialog t={t} direction="out" invoiceId={i.id} open={open} label={i.number} /> : null}</td></tr>);
            })}</tbody></table>
            <p className="mt-2 text-xs text-muted-foreground">Le paiement d&apos;un fournisseur n&apos;est jamais effectué par l&apos;application : enregistrez ici un paiement déjà réalisé dans votre banque.</p></CardContent></Card>
      )}

      {tab === "expenses" && (
        <Card><CardHeader><CardTitle>{t.finance.expenses}</CardTitle>{can(user.role, "expenses.write") ? <ExpenseDialog t={t} projects={projectOpts} employees={(employees ?? []).map((e) => ({ value: e.id, label: e.full_name }))} /> : null}</CardHeader>
          <CardContent className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-xs text-muted-foreground">
            <th className="py-2 text-left">{t.common.date}</th><th className="text-left">{t.common.description}</th><th className="text-left">{t.finance.category}</th><th className="text-left">{t.common.project}</th>
            <th className="text-right">Heures</th><th className="text-right">{t.common.excl}</th><th className="pl-3 text-left">{t.finance.settlement}</th><th /></tr></thead>
            <tbody>{[...data.expenses].sort((a, b) => b.expense_date.localeCompare(a.expense_date)).map((e) => {
              const open = e.settlement === "payable" ? e.amount_total - (paidE.get(e.id) ?? 0) : 0;
              return (<tr key={e.id} className="border-b last:border-0"><td className="py-2">{fd(e.expense_date)}</td><td>{e.description}</td><td>{t.categories[e.category]}</td>
                <td>{projects.get(e.project_id ?? "")?.reference ?? "—"}</td><td className="text-right tabular">{e.hours ?? ""}</td><td className="text-right tabular">{eur(e.amount_excl)}</td>
                <td className="pl-3">{e.settlement === "payroll" ? <Badge variant="outline">paie</Badge> : <Badge variant="outline">{t.finance.paymentStatus[paymentStatus(e.amount_total, paidE.get(e.id) ?? 0)]}</Badge>}</td>
                <td className="text-right">{write && open > 0 ? <PaymentDialog t={t} direction="out" expenseId={e.id} open={open} label={e.description} /> : null}</td></tr>);
            })}</tbody></table></CardContent></Card>
      )}

      {tab === "payments" && (
        <Card><CardHeader><CardTitle>{t.finance.payments}</CardTitle></CardHeader><CardContent className="overflow-x-auto">
          <table className="w-full text-sm"><thead><tr className="border-b text-xs text-muted-foreground"><th className="py-2 text-left">{t.common.date}</th><th className="text-left">Sens</th>
            <th className="text-right">{t.common.amount}</th><th className="pl-3 text-left">Objet</th><th className="text-left">{t.common.project}</th><th className="text-left">{t.finance.reference}</th></tr></thead>
            <tbody>{[...data.payments].sort((a, b) => b.payment_date.localeCompare(a.payment_date)).map((p) => {
              const inv = data.invoices.find((i) => i.id === p.invoice_id), exp = data.expenses.find((e) => e.id === p.expense_id), obl = data.obligations.find((o) => o.id === p.obligation_id);
              return (<tr key={p.id} className="border-b last:border-0"><td className="py-2">{fd(p.payment_date)}</td><td>{p.direction === "in" ? "↘ " + t.finance.direction.in : "↗ " + t.finance.direction.out}</td>
                <td className={cn("text-right tabular", p.direction === "in" ? "text-good" : "")}>{p.direction === "out" ? "−" : "+"}{eur(p.amount)}</td>
                <td className="pl-3">{inv ? `Facture ${inv.number}` : exp ? exp.description : obl ? obl.label : "—"}</td><td>{projects.get(p.project_id ?? "")?.reference ?? "—"}</td>
                <td className="text-xs text-muted-foreground">{(p as unknown as { reference?: string }).reference ?? ""}</td></tr>);
            })}</tbody></table></CardContent></Card>
      )}

      {tab === "forecast" && (() => {
        const fc = allForecasts(data, today);
        const bank = bankPosition(data.bankBalances, today);
        return (
          <div className="grid gap-4">
            {!bank.known ? <div className="rounded-md border border-warning/60 bg-warning/10 p-3 text-sm">⚠ {t.dashboard.cashUnknown} : seuls les flux sont calculés.</div> : null}
            <div className="grid gap-4 md:grid-cols-3">{SCENARIOS.map((sc) => (
              <Card key={sc} data-testid={`scenario-${sc}`}><CardHeader><CardTitle>{t.finance.scenarios[sc]}</CardTitle><span className="text-xs text-muted-foreground">départ {eur0(fc[sc].startBalance)}</span></CardHeader><CardContent>
                <table className="w-full text-xs"><thead><tr className="text-muted-foreground"><th className="text-left">{t.finance.horizon}</th><th className="text-right">{t.finance.inflow}</th><th className="text-right">{t.finance.outflow}</th><th className="text-right">{t.finance.closing}</th><th className="text-right">{t.finance.minBalance}</th></tr></thead>
                  <tbody>{HORIZONS.map((h) => { const x = fc[sc].horizons[h]; return (<tr key={h} className="border-t"><td className="py-1.5">{h} j</td><td className="text-right tabular">{eur0(x.inflow)}</td><td className="text-right tabular">{eur0(x.outflow)}</td>
                    <td className={cn("text-right tabular", (x.closing ?? 0) < 0 && "text-critical font-semibold")}>{eur0(x.closing)}</td><td className={cn("text-right tabular", (x.minBalance ?? 0) < 0 && "text-critical font-semibold")}>{eur0(x.minBalance)}</td></tr>); })}</tbody></table>
                <p className="mt-2 text-xs text-muted-foreground">{t.finance.excluded} : {eur0(fc[sc].excludedReceivables)}</p>
                <ul className="mt-2 list-disc pl-4 text-xs text-muted-foreground">{SCENARIO_RULES[sc].map((r) => <li key={r}>{r}</li>)}</ul>
              </CardContent></Card>))}</div>
            <Card><CardHeader><CardTitle>{t.finance.assumptions}</CardTitle></CardHeader><CardContent><ul className="list-disc pl-4 text-sm">{COMMON_RULES.map((r) => <li key={r}>{r}</li>)}</ul></CardContent></Card>
          </div>
        );
      })()}

      {tab === "obligations" && (() => {
        const bank = bankPosition(data.bankBalances, today);
        const occ = obligationOccurrences(data.obligations, today, addDays(today, 30), true);
        return (
          <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-3">
              <Kpi label={t.dashboard.cash} value={bank.known ? eur0(bank.balance) : "—"} sub={bank.known ? `${t.finance.manualBalance} · ${fd(bank.asOf)}` : t.dashboard.cashUnknown} />
              <Kpi label={`${t.finance.upcoming}`} value={eur0(sum(occ.map((o) => o.amount)) + sum(payables(data, today).filter((p) => p.due_date <= addDays(today, 30) && !p.disputed).map((p) => p.open)))} sub="obligations + dettes à 30 j" />
              <Kpi label="Prêts, crédits & leasings (mensualités actives)" value={eur0(sum(data.obligations.filter((o) => o.active && ["loan", "credit_facility", "leasing"].includes(o.kind) && o.frequency === "monthly").map((o) => o.amount)))} sub="par mois" />
            </div>
            <Card><CardHeader><CardTitle>{t.finance.bank}</CardTitle>{can(user.role, "bank.write") ? <BankBalanceDialog t={t} accounts={bank.accounts.map((a) => a.account_label)} /> : null}</CardHeader><CardContent>
              {!bank.accounts.length ? <p className="text-sm text-muted-foreground">{t.dashboard.cashUnknown}</p> : <ul className="divide-y text-sm">{bank.accounts.map((a) => (
                <li key={a.account_label} className="flex justify-between py-2"><span>{a.account_label} <span className="text-xs text-muted-foreground">· {fd(a.as_of)} · {t.common.manualEntry}</span></span><span className="tabular">{eur(a.balance)}</span></li>))}</ul>}
            </CardContent></Card>
            <Card><CardHeader><CardTitle>{t.finance.obligations}</CardTitle>{can(user.role, "bank.write") ? <ObligationDialog t={t} /> : null}</CardHeader><CardContent className="overflow-x-auto">
              <table className="w-full text-sm"><thead><tr className="border-b text-xs text-muted-foreground"><th className="py-2 text-left">{t.common.description}</th><th className="text-left">Organisme</th><th className="text-left">Fréquence</th><th className="text-right">{t.common.amount}</th><th className="pl-3 text-left">Prochaine échéance</th><th /></tr></thead>
                <tbody>{data.obligations.filter((o) => o.active).sort((a, b) => a.next_due_date.localeCompare(b.next_due_date)).map((o) => (
                  <tr key={o.id} className="border-b last:border-0"><td className="py-2">{o.label}</td><td>{o.counterparty ?? "—"}</td><td>{o.frequency}</td><td className="text-right tabular">{eur(o.amount)}</td>
                    <td className="pl-3">{fd(o.next_due_date)}{o.next_due_date < today ? <> <SeverityBadge severity="warning" label="non confirmée" /></> : null}</td>
                    <td className="text-right">{can(user.role, "bank.write") && o.next_due_date <= addDays(today, 7) ? <ConfirmObligation id={o.id} label={t.finance.confirmPaid} /> : null}</td></tr>))}</tbody></table>
            </CardContent></Card>
          </div>
        );
      })()}
    </div>
  );
}

function addDays(d: string, n: number) {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
