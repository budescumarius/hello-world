/** Constructeurs de données synthétiques pour les tests (aucune donnée réelle). */
import type { CompanyData, Expense, Invoice, Obligation, Payment, Project } from "@/lib/domain/types";

let n = 0;
const id = (p: string) => `${p}-${++n}`;

export function emptyData(): CompanyData {
  return { projects: [], invoices: [], expenses: [], payments: [], obligations: [], bankBalances: [], changeOrders: [],
    clients: [], suppliers: [], subcontractors: [], tasks: [], documents: [] };
}

export function project(p: Partial<Project> = {}): Project {
  return {
    id: id("prj"), reference: "MAD-T-001", name: "Chantier test", status: "in_progress", client_id: "cli-1", site_address: null,
    contract_amount_excl: 10_000_000, vat_rate: 6, start_date: "2026-06-01", planned_end_date: "2026-12-31", actual_end_date: null,
    progress_pct: 50, progress_updated_at: "2026-10-30T08:00:00Z", budget_materials: 3_000_000, budget_labour: 3_000_000,
    budget_subcontract: 2_000_000, budget_other: 0, forecast_cost_override: null, archived_at: null, ...p,
  };
}

export function issued(p: Partial<Invoice> & { amount_excl: number }): Invoice {
  const vat = p.vat_amount ?? Math.round(p.amount_excl * 0.06);
  return {
    id: id("inv"), direction: "issued", number: `F-${n}`, kind: "progress", project_id: null, client_id: "cli-1", supplier_id: null,
    subcontractor_id: null, cost_category: null, issue_date: "2026-09-01", due_date: "2026-10-01", vat_amount: vat,
    amount_total: p.amount_excl + vat, status: "issued", ...p,
  };
}

export function received(p: Partial<Invoice> & { amount_excl: number }): Invoice {
  const vat = p.vat_amount ?? Math.round(p.amount_excl * 0.21);
  return {
    id: id("pinv"), direction: "received", number: `A-${n}`, kind: "standard", project_id: null, client_id: null, supplier_id: "sup-1",
    subcontractor_id: null, cost_category: "materials", issue_date: "2026-09-01", due_date: "2026-10-01", vat_amount: vat,
    amount_total: p.amount_excl + vat, status: "received", ...p,
  };
}

export function payment(p: Partial<Payment> & { amount: number }): Payment {
  return { id: id("pay"), direction: "in", payment_date: "2026-10-01", invoice_id: null, expense_id: null, obligation_id: null, project_id: null, ...p };
}

export function expense(p: Partial<Expense> & { amount_excl: number }): Expense {
  return { id: id("exp"), project_id: null, category: "labour", description: "Main-d'œuvre", expense_date: "2026-10-01",
    amount_total: p.amount_excl, settlement: "payroll", supplier_id: null, subcontractor_id: null, employee_id: null, hours: null, ...p };
}

export function obligation(p: Partial<Obligation> & { amount: number }): Obligation {
  return { id: id("obl"), kind: "loan", label: "Prêt", counterparty: null, frequency: "monthly", next_due_date: "2026-11-05", end_date: null, active: true, ...p };
}
