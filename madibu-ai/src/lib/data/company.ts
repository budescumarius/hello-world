import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanyData } from "../domain/types";
import { toCents } from "../money";

/** Charge les données de l'entreprise visibles par le client fourni (RLS) et les convertit en centimes. */
export async function loadCompanyData(sb: SupabaseClient): Promise<CompanyData> {
  const q = async <T,>(p: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> => {
    const { data, error } = await p;
    if (error) throw new Error(error.message);
    return data ?? [];
  };
  const c = (v: unknown) => toCents(v as number | null);
  const cc = (v: unknown) => toCents(v as number) ?? 0;

  const [projects, invoices, expenses, payments, obligations, bank, cos, clients, suppliers, subs, tasks, docs] = await Promise.all([
    q<Record<string, unknown>>(sb.from("projects").select("*")),
    q<Record<string, unknown>>(sb.from("invoices").select("*")),
    q<Record<string, unknown>>(sb.from("expenses").select("*")),
    q<Record<string, unknown>>(sb.from("payments").select("*")),
    q<Record<string, unknown>>(sb.from("recurring_obligations").select("*")),
    q<Record<string, unknown>>(sb.from("bank_balances").select("*")),
    q<Record<string, unknown>>(sb.from("change_orders").select("*")),
    q<Record<string, unknown>>(sb.from("clients").select("id, name, email")),
    q<Record<string, unknown>>(sb.from("suppliers").select("id, name, email")),
    q<Record<string, unknown>>(sb.from("subcontractors").select("id, name, email, insurance_valid_until")),
    q<Record<string, unknown>>(sb.from("tasks").select("id, title, project_id, status, priority, due_date, assigned_to, source")),
    q<Record<string, unknown>>(sb.from("documents").select("project_id, category")),
  ]);

  return ({
    projects: projects.map((p) => ({
      ...p,
      contract_amount_excl: c(p.contract_amount_excl), vat_rate: p.vat_rate === null ? null : Number(p.vat_rate),
      progress_pct: p.progress_pct === null ? null : Number(p.progress_pct),
      budget_materials: c(p.budget_materials), budget_labour: c(p.budget_labour), budget_subcontract: c(p.budget_subcontract),
      budget_other: c(p.budget_other), forecast_cost_override: c(p.forecast_cost_override),
    })),
    invoices: invoices.map((i) => ({ ...i, amount_excl: cc(i.amount_excl), vat_amount: cc(i.vat_amount), amount_total: cc(i.amount_total) })),
    expenses: expenses.map((e) => ({ ...e, amount_excl: cc(e.amount_excl), amount_total: cc(e.amount_total), hours: e.hours === null ? null : Number(e.hours) })),
    payments: payments.map((p) => ({ ...p, amount: cc(p.amount) })),
    obligations: obligations.map((o) => ({ ...o, amount: cc(o.amount) })),
    bankBalances: bank.map((b) => ({ ...b, balance: cc(b.balance) })),
    changeOrders: cos.map((co) => ({ ...co, amount_excl: c(co.amount_excl) })),
    clients: clients.map((x) => ({ ...x, kind: "client" as const })),
    suppliers: suppliers.map((x) => ({ ...x, kind: "supplier" as const })),
    subcontractors: subs.map((x) => ({ ...x, kind: "subcontractor" as const })),
    tasks,
    documents: docs,
  }) as unknown as CompanyData;
}
