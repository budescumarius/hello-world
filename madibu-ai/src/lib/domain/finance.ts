/**
 * Contrôle financier – fonctions pures (testées par Vitest).
 *
 * Principes appliqués partout :
 * - facturé ≠ encaissé : l'encaissé provient UNIQUEMENT des paiements enregistrés ;
 * - coût engagé (factures reçues, dépenses) ≠ coût payé (paiements sortants) ;
 * - montants de rentabilité en HTVA ; trésorerie en TVAC (flux réels) ;
 * - aucune donnée manquante n'est inventée : l'indicateur dépendant reste `null`
 *   et la donnée manquante est listée dans `missing`.
 */
import { addDays, addMonths, daysBetween, maxDate, weekStart } from "../dates";
import { type Cents, sum } from "../money";
import type { BankBalance, ChangeOrder, CompanyData, Expense, Invoice, Obligation, Payment, Project } from "./types";

export const ACTIVE_STATUSES = ["signed", "in_progress", "on_hold"] as const;
export const isActive = (p: Project) => !p.archived_at && (ACTIVE_STATUSES as readonly string[]).includes(p.status);

const countsAsInvoiced = (i: Invoice) => i.direction === "issued" && (i.status === "issued" || i.status === "disputed");
const countsAsCost = (i: Invoice) => i.direction === "received" && i.status !== "cancelled";
const sign = (i: Invoice) => (i.kind === "credit_note" ? -1 : 1);

export function paidByInvoice(payments: Payment[]): Map<string, Cents> {
  const m = new Map<string, Cents>();
  for (const p of payments) if (p.invoice_id) m.set(p.invoice_id, (m.get(p.invoice_id) ?? 0) + p.amount);
  return m;
}
export function paidByExpense(payments: Payment[]): Map<string, Cents> {
  const m = new Map<string, Cents>();
  for (const p of payments) if (p.expense_id) m.set(p.expense_id, (m.get(p.expense_id) ?? 0) + p.amount);
  return m;
}

export type PaymentStatus = "unpaid" | "partial" | "paid";
export function paymentStatus(total: Cents, paid: Cents): PaymentStatus {
  if (paid <= 0) return "unpaid";
  return paid >= total ? "paid" : "partial";
}

// ----------------------------------------------------------------------------- chantier
export interface ProjectFinancials {
  contractExcl: Cents | null;
  approvedChangeOrders: Cents;
  pendingChangeOrders: Cents;
  totalContractExcl: Cents | null;
  invoicedExcl: Cents;
  invoicedTotal: Cents;
  collected: Cents;
  outstandingReceivable: Cents;
  costs: { materials: Cents; labour: Cents; subcontract: Cents; other: Cents };
  costsIncurred: Cents;
  costsPaid: Cents;
  unpaidCommitments: Cents;
  payrollLabour: Cents;
  budgetTotal: Cents | null;
  remainingBudget: Cents | null;
  budgetUsedPct: number | null;
  progressPct: number | null;
  plannedProgressPct: number | null;
  forecastFinalCost: Cents | null;
  forecastMethod: "manual" | "trend" | "actual" | "budget" | null;
  estimatedProfit: Cents | null;
  estimatedMarginPct: number | null;
  earnedValue: Cents | null;
  unbilledWork: Cents | null;
  cashPosition: Cents;
  hasAdvanceInvoice: boolean;
  daysLate: number | null;
  missing: string[];
}

export function projectFinancials(project: Project, data: Pick<CompanyData, "invoices" | "expenses" | "payments" | "changeOrders">, today: string): ProjectFinancials {
  const missing: string[] = [];
  const invoices = data.invoices.filter((i) => i.project_id === project.id);
  const expenses = data.expenses.filter((e) => e.project_id === project.id);
  const cos = data.changeOrders.filter((c) => c.project_id === project.id);
  const paidInv = paidByInvoice(data.payments);
  const paidExp = paidByExpense(data.payments);

  const approvedCO = sum(cos.filter((c) => c.status === "approved").map((c) => c.amount_excl));
  const pendingCO = sum(cos.filter((c) => c.status === "requested" || c.status === "quoted").map((c) => c.amount_excl));
  const contract = project.contract_amount_excl;
  if (contract === null) missing.push("contract_amount");
  const totalContract = contract === null ? null : contract + approvedCO;

  const issued = invoices.filter(countsAsInvoiced);
  const invoicedExcl = sum(issued.map((i) => sign(i) * i.amount_excl));
  const invoicedTotal = sum(issued.map((i) => sign(i) * i.amount_total));
  const collected = sum(issued.map((i) => sign(i) * (paidInv.get(i.id) ?? 0)));

  const costs = { materials: 0, labour: 0, subcontract: 0, other: 0 };
  const bucket = (cat: string | null, isSub: boolean): keyof typeof costs =>
    isSub || cat === "subcontract" ? "subcontract" : cat === "materials" ? "materials" : cat === "labour" ? "labour" : "other";
  let costsPaid = 0;
  let unpaid = 0;
  let payroll = 0;
  for (const i of invoices.filter(countsAsCost)) {
    costs[bucket(i.cost_category, !!i.subcontractor_id)] += i.amount_excl;
    const paid = paidInv.get(i.id) ?? 0;
    costsPaid += paid;
    unpaid += Math.max(0, i.amount_total - paid);
  }
  for (const e of expenses) {
    costs[bucket(e.category, !!e.subcontractor_id)] += e.amount_excl;
    if (e.settlement === "payroll") {
      payroll += e.amount_excl;
    } else {
      const paid = paidExp.get(e.id) ?? 0;
      costsPaid += paid;
      unpaid += Math.max(0, e.amount_total - paid);
    }
  }
  const costsIncurred = costs.materials + costs.labour + costs.subcontract + costs.other;

  const budgetParts = [project.budget_materials, project.budget_labour, project.budget_subcontract, project.budget_other];
  const known = budgetParts.filter((v): v is number => v !== null);
  const budgetTotal = known.length ? sum(known) : null;
  if (budgetTotal === null) missing.push("budget");
  const remainingBudget = budgetTotal === null ? null : budgetTotal - costsIncurred;
  const budgetUsedPct = budgetTotal ? (costsIncurred / budgetTotal) * 100 : null;

  const progress = project.progress_pct;
  if (progress === null && project.status === "in_progress") missing.push("progress");
  if (!project.planned_end_date && project.status !== "offer" && project.status !== "cancelled") missing.push("planned_end_date");
  if (!project.client_id) missing.push("client");

  let plannedProgress: number | null = null;
  if (project.start_date && project.planned_end_date) {
    const span = daysBetween(project.start_date, project.planned_end_date);
    if (span > 0) plannedProgress = Math.max(0, Math.min(100, (daysBetween(project.start_date, today) / span) * 100));
  }

  let forecast: Cents | null = null;
  let method: ProjectFinancials["forecastMethod"] = null;
  if (project.forecast_cost_override !== null) {
    forecast = Math.max(project.forecast_cost_override, costsIncurred);
    method = "manual";
  } else if (project.status === "completed" || project.status === "handed_over") {
    forecast = costsIncurred;
    method = "actual";
  } else if (progress !== null && progress >= 10 && costsIncurred > 0) {
    forecast = Math.max(costsIncurred, Math.round(costsIncurred / (progress / 100)));
    method = "trend";
  } else if (budgetTotal !== null) {
    forecast = Math.max(budgetTotal, costsIncurred);
    method = "budget";
  }

  const profit = totalContract !== null && forecast !== null ? totalContract - forecast : null;
  const margin = profit !== null && totalContract ? (profit / totalContract) * 100 : null;
  const earned = totalContract !== null && progress !== null ? Math.round((totalContract * progress) / 100) : null;
  const unbilled = earned !== null ? earned - invoicedExcl : null;

  let daysLate: number | null = null;
  if (project.planned_end_date && !["completed", "handed_over", "cancelled", "offer"].includes(project.status)) {
    daysLate = Math.max(0, daysBetween(project.planned_end_date, today));
  }

  return {
    contractExcl: contract, approvedChangeOrders: approvedCO, pendingChangeOrders: pendingCO, totalContractExcl: totalContract,
    invoicedExcl, invoicedTotal, collected, outstandingReceivable: invoicedTotal - collected,
    costs, costsIncurred, costsPaid, unpaidCommitments: unpaid, payrollLabour: payroll,
    budgetTotal, remainingBudget, budgetUsedPct, progressPct: progress, plannedProgressPct: plannedProgress,
    forecastFinalCost: forecast, forecastMethod: method, estimatedProfit: profit, estimatedMarginPct: margin,
    earnedValue: earned, unbilledWork: unbilled, cashPosition: collected - costsPaid,
    hasAdvanceInvoice: issued.some((i) => i.kind === "advance"), daysLate, missing,
  };
}

// ----------------------------------------------------------------------------- créances & dettes
export interface OpenItem {
  id: string;
  type: "invoice" | "expense";
  direction: "receivable" | "payable";
  number: string;
  project_id: string | null;
  party_id: string | null;
  issue_date: string;
  due_date: string;
  total: Cents;
  paid: Cents;
  open: Cents;
  daysOverdue: number;
  disputed: boolean;
  bucket: AgingBucket;
}
export type AgingBucket = "not_due" | "d1_30" | "d31_60" | "d61_90" | "d90_plus";
export const AGING_BUCKETS: AgingBucket[] = ["not_due", "d1_30", "d31_60", "d61_90", "d90_plus"];

export function agingBucket(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return "not_due";
  if (daysOverdue <= 30) return "d1_30";
  if (daysOverdue <= 60) return "d31_60";
  if (daysOverdue <= 90) return "d61_90";
  return "d90_plus";
}

export function receivables(data: Pick<CompanyData, "invoices" | "payments">, today: string): OpenItem[] {
  const paid = paidByInvoice(data.payments);
  return data.invoices
    .filter((i) => countsAsInvoiced(i) && i.kind !== "credit_note")
    .map((i) => {
      const p = paid.get(i.id) ?? 0;
      const d = daysBetween(i.due_date, today);
      return {
        id: i.id, type: "invoice" as const, direction: "receivable" as const, number: i.number, project_id: i.project_id,
        party_id: i.client_id, issue_date: i.issue_date, due_date: i.due_date, total: i.amount_total, paid: p,
        open: i.amount_total - p, daysOverdue: d, disputed: i.status === "disputed", bucket: agingBucket(d),
      };
    })
    .filter((r) => r.open > 0)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
}

export function payables(data: Pick<CompanyData, "invoices" | "payments" | "expenses">, today: string): OpenItem[] {
  const paidI = paidByInvoice(data.payments);
  const paidE = paidByExpense(data.payments);
  const fromInvoices = data.invoices.filter(countsAsCost).map((i) => {
    const p = paidI.get(i.id) ?? 0;
    const d = daysBetween(i.due_date, today);
    return {
      id: i.id, type: "invoice" as const, direction: "payable" as const, number: i.number, project_id: i.project_id,
      party_id: i.supplier_id ?? i.subcontractor_id, issue_date: i.issue_date, due_date: i.due_date, total: i.amount_total,
      paid: p, open: i.amount_total - p, daysOverdue: d, disputed: i.status === "disputed", bucket: agingBucket(d),
    };
  });
  const fromExpenses = data.expenses.filter((e) => e.settlement === "payable").map((e) => {
    const p = paidE.get(e.id) ?? 0;
    const d = daysBetween(e.expense_date, today);
    return {
      id: e.id, type: "expense" as const, direction: "payable" as const, number: e.description, project_id: e.project_id,
      party_id: e.supplier_id ?? e.subcontractor_id, issue_date: e.expense_date, due_date: e.expense_date, total: e.amount_total,
      paid: p, open: e.amount_total - p, daysOverdue: d, disputed: false, bucket: agingBucket(d),
    };
  });
  return [...fromInvoices, ...fromExpenses].filter((r) => r.open > 0).sort((a, b) => a.due_date.localeCompare(b.due_date));
}

export function aging(items: OpenItem[]): Record<AgingBucket, Cents> {
  const r = { not_due: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  for (const i of items) r[i.bucket] += i.open;
  return r;
}

// ----------------------------------------------------------------------------- obligations & banque
export interface Occurrence { obligation_id: string; label: string; kind: string; date: string; amount: Cents; overdue: boolean }

export function obligationOccurrences(obligations: Obligation[], from: string, to: string, includeOverdue = false): Occurrence[] {
  const step = { monthly: 1, quarterly: 3, yearly: 12 } as const;
  const out: Occurrence[] = [];
  for (const o of obligations.filter((x) => x.active)) {
    const stop = o.end_date && o.end_date < to ? o.end_date : to;
    let d = o.next_due_date;
    for (let n = 1; d <= stop && n < 500; n++) {
      if (d >= from || includeOverdue) out.push({ obligation_id: o.id, label: o.label, kind: o.kind, date: d, amount: o.amount, overdue: d < from });
      if (o.frequency === "once") break;
      d = addMonths(o.next_due_date, step[o.frequency] * n);
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export interface BankPosition { known: boolean; balance: Cents | null; asOf: string | null; ageDays: number | null; accounts: BankBalance[] }

export function bankPosition(balances: BankBalance[], today: string): BankPosition {
  const latest = new Map<string, BankBalance>();
  for (const b of balances) {
    const cur = latest.get(b.account_label);
    if (!cur || b.as_of > cur.as_of) latest.set(b.account_label, b);
  }
  const accounts = [...latest.values()];
  if (!accounts.length) return { known: false, balance: null, asOf: null, ageDays: null, accounts };
  const asOf = accounts.map((a) => a.as_of).sort()[0];
  return { known: true, balance: sum(accounts.map((a) => a.balance)), asOf, ageDays: daysBetween(asOf, today), accounts };
}

// ----------------------------------------------------------------------------- prévisions
export type Scenario = "optimistic" | "realistic" | "pessimistic";
export const SCENARIOS: Scenario[] = ["optimistic", "realistic", "pessimistic"];
export const HORIZONS = [7, 30, 90] as const;

/** Retard moyen historique de paiement par client (jours après échéance, ≥ 0). */
export function clientPaymentDelays(data: Pick<CompanyData, "invoices" | "payments">): Map<string, number> {
  const lastPay = new Map<string, string>();
  const paid = paidByInvoice(data.payments);
  for (const p of data.payments) {
    if (p.invoice_id && (!lastPay.has(p.invoice_id) || p.payment_date > lastPay.get(p.invoice_id)!)) lastPay.set(p.invoice_id, p.payment_date);
  }
  const acc = new Map<string, number[]>();
  for (const i of data.invoices) {
    if (i.direction !== "issued" || !i.client_id || i.kind === "credit_note") continue;
    if ((paid.get(i.id) ?? 0) < i.amount_total || !lastPay.has(i.id)) continue;
    const delay = Math.max(0, daysBetween(i.due_date, lastPay.get(i.id)!));
    acc.set(i.client_id, [...(acc.get(i.client_id) ?? []), delay]);
  }
  const m = new Map<string, number>();
  for (const [k, v] of acc) m.set(k, Math.round(v.reduce((a, b) => a + b, 0) / v.length));
  return m;
}

export const DEFAULT_PAYMENT_DELAY_DAYS = 15;

/** Date d'encaissement attendue d'une créance selon le scénario ; `null` = exclue du scénario. */
export function expectedCollectionDate(r: OpenItem, scenario: Scenario, today: string, clientDelay: number | undefined): string | null {
  if (r.disputed) return null; // une facture contestée n'est comptée dans aucun scénario
  const delay = clientDelay ?? DEFAULT_PAYMENT_DELAY_DAYS;
  const overdue = r.daysOverdue;
  switch (scenario) {
    case "optimistic":
      return overdue > 0 ? addDays(today, 7) : r.due_date;
    case "realistic":
      if (overdue > 60) return null;
      return overdue > 0 ? addDays(today, 30) : addDays(r.due_date, delay);
    case "pessimistic":
      if (overdue > 30) return null;
      return overdue > 0 ? addDays(today, 60) : addDays(r.due_date, Math.max(30, delay));
  }
}

export interface FlowItem { date: string; amount: Cents; label: string; kind: "in" | "out"; ref?: string }
export interface ScenarioForecast {
  scenario: Scenario;
  startBalance: Cents | null;
  horizons: Record<(typeof HORIZONS)[number], { inflow: Cents; outflow: Cents; closing: Cents | null; minBalance: Cents | null; minDate: string | null }>;
  weekly: Array<{ weekStart: string; inflow: Cents; outflow: Cents; closing: Cents | null }>;
  excludedReceivables: Cents;
  items: FlowItem[];
}

export const SCENARIO_RULES: Record<Scenario, string[]> = {
  optimistic: ["Créances non échues encaissées à l'échéance", "Créances en retard encaissées sous 7 jours"],
  realistic: ["Créances non échues encaissées à l'échéance + retard moyen historique du client (15 j par défaut)",
    "Créances en retard ≤ 60 j encaissées sous 30 jours", "Créances en retard > 60 j exclues"],
  pessimistic: ["Créances non échues encaissées 30 j après l'échéance (ou retard historique si plus long)",
    "Créances en retard ≤ 30 j encaissées sous 60 jours", "Créances en retard > 30 j exclues"],
};
export const COMMON_RULES = [
  "Factures contestées exclues de tous les scénarios",
  "Dettes fournisseurs et sous-traitants payées à l'échéance ; dettes échues comptées aujourd'hui",
  "Obligations récurrentes (prêts, leasings, salaires, ONSS, TVA…) à leur date ; échéances non actualisées comptées aujourd'hui",
  "Aucune nouvelle facturation ni nouvelle dépense n'est supposée",
];

export function forecast(data: CompanyData, scenario: Scenario, today: string): ScenarioForecast {
  const horizonEnd = addDays(today, 90);
  const bank = bankPosition(data.bankBalances, today);
  const delays = clientPaymentDelays(data);
  const items: FlowItem[] = [];
  let excluded = 0;

  for (const r of receivables(data, today)) {
    const d = expectedCollectionDate(r, scenario, today, r.party_id ? delays.get(r.party_id) : undefined);
    if (d === null) { excluded += r.open; continue; }
    if (d <= horizonEnd) items.push({ date: d, amount: r.open, label: `Facture ${r.number}`, kind: "in", ref: r.id });
  }
  for (const p of payables(data, today)) {
    const d = maxDate(p.due_date, today);
    if (d <= horizonEnd) items.push({ date: d, amount: p.open, label: p.number, kind: "out", ref: p.id });
  }
  for (const o of obligationOccurrences(data.obligations, today, horizonEnd, true)) {
    items.push({ date: maxDate(o.date, today), amount: o.amount, label: o.label, kind: "out", ref: o.obligation_id });
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === "out" ? -1 : 1)); // sorties d'abord : prudence

  const start = bank.balance;
  const horizons = {} as ScenarioForecast["horizons"];
  for (const h of HORIZONS) {
    const end = addDays(today, h);
    let inflow = 0, outflow = 0, running = start, min: Cents | null = start, minDate: string | null = start === null ? null : today;
    for (const it of items.filter((x) => x.date <= end)) {
      if (it.kind === "in") inflow += it.amount; else outflow += it.amount;
      if (running !== null) {
        running += it.kind === "in" ? it.amount : -it.amount;
        if (min === null || running < min) { min = running; minDate = it.date; }
      }
    }
    horizons[h] = { inflow, outflow, closing: start === null ? null : start + inflow - outflow, minBalance: min, minDate };
  }

  const weekly: ScenarioForecast["weekly"] = [];
  let running = start;
  const w0 = weekStart(today);
  for (let w = 0; w < 13; w++) {
    const ws = addDays(w0, w * 7), we = addDays(ws, 6);
    const inW = items.filter((x) => x.date >= ws && x.date <= we);
    const inflow = sum(inW.filter((x) => x.kind === "in").map((x) => x.amount));
    const outflow = sum(inW.filter((x) => x.kind === "out").map((x) => x.amount));
    if (running !== null) running += inflow - outflow;
    weekly.push({ weekStart: ws, inflow, outflow, closing: running });
  }
  return { scenario, startBalance: start, horizons, weekly, excludedReceivables: excluded, items };
}

export function allForecasts(data: CompanyData, today: string): Record<Scenario, ScenarioForecast> {
  return { optimistic: forecast(data, "optimistic", today), realistic: forecast(data, "realistic", today), pessimistic: forecast(data, "pessimistic", today) };
}

// ----------------------------------------------------------------------------- synthèse entreprise
export interface CompanySummary {
  activeProjects: number;
  signedContractValue: Cents;
  unknownContractValues: number;
  revenueInvoicedExcl: Cents;
  cashCollected: Cents;
  receivablesOpen: Cents;
  receivablesOverdue: Cents;
  overdueInvoiceCount: number;
  costsIncurred: Cents;
  costsPaid: Cents;
  payablesOpen: Cents;
  payablesOverdue: Cents;
  bank: BankPosition;
  estimatedProfit: Cents | null;
  projectsWithoutEstimate: number;
}

export function companySummary(data: CompanyData, today: string): CompanySummary {
  const active = data.projects.filter(isActive);
  const fins = active.map((p) => projectFinancials(p, data, today));
  const rec = receivables(data, today);
  const pay = payables(data, today);
  const issued = data.invoices.filter(countsAsInvoiced);
  const paidI = paidByInvoice(data.payments);
  const profits = fins.map((f) => f.estimatedProfit).filter((v): v is number => v !== null);
  return {
    activeProjects: active.length,
    signedContractValue: sum(fins.map((f) => f.totalContractExcl)),
    unknownContractValues: fins.filter((f) => f.totalContractExcl === null).length,
    revenueInvoicedExcl: sum(issued.map((i) => sign(i) * i.amount_excl)),
    cashCollected: sum(issued.map((i) => sign(i) * (paidI.get(i.id) ?? 0))),
    receivablesOpen: sum(rec.map((r) => r.open)),
    receivablesOverdue: sum(rec.filter((r) => r.daysOverdue > 0).map((r) => r.open)),
    overdueInvoiceCount: rec.filter((r) => r.daysOverdue > 0).length,
    costsIncurred: sum(data.invoices.filter(countsAsCost).map((i) => i.amount_excl)) + sum(data.expenses.map((e) => e.amount_excl)),
    costsPaid: sum(data.payments.filter((p) => p.direction === "out").map((p) => p.amount)),
    payablesOpen: sum(pay.map((p) => p.open)),
    payablesOverdue: sum(pay.filter((p) => p.daysOverdue > 0).map((p) => p.open)),
    bank: bankPosition(data.bankBalances, today),
    estimatedProfit: profits.length ? sum(profits) : null,
    projectsWithoutEstimate: fins.length - profits.length,
  };
}

export type { ChangeOrder, Expense };
