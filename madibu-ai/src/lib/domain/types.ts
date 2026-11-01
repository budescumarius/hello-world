/**
 * Types du domaine, en centimes entiers. Les lignes Supabase sont converties par `normalize.ts`.
 * `null` signifie toujours « donnée inconnue » : elle n'est jamais remplacée par une estimation.
 */
import type { Cents } from "../money";

export type Role = "owner" | "admin" | "finance" | "project_manager" | "site_manager" | "employee";
export type ProjectStatus = "offer" | "signed" | "in_progress" | "on_hold" | "completed" | "handed_over" | "cancelled";
export type CostCategory = "materials" | "labour" | "subcontract" | "equipment" | "transport" | "overhead" | "other";

export interface Project {
  id: string;
  reference: string;
  name: string;
  status: ProjectStatus;
  client_id: string | null;
  site_address: string | null;
  contract_amount_excl: Cents | null;
  vat_rate: number | null;
  start_date: string | null;
  planned_end_date: string | null;
  actual_end_date: string | null;
  progress_pct: number | null;
  progress_updated_at: string | null;
  budget_materials: Cents | null;
  budget_labour: Cents | null;
  budget_subcontract: Cents | null;
  budget_other: Cents | null;
  forecast_cost_override: Cents | null;
  archived_at: string | null;
}

export interface Invoice {
  id: string;
  direction: "issued" | "received";
  number: string;
  kind: "advance" | "progress" | "final" | "credit_note" | "standard";
  project_id: string | null;
  client_id: string | null;
  supplier_id: string | null;
  subcontractor_id: string | null;
  cost_category: CostCategory | null;
  issue_date: string;
  due_date: string;
  amount_excl: Cents;
  vat_amount: Cents;
  amount_total: Cents;
  status: "draft" | "issued" | "received" | "approved" | "disputed" | "cancelled";
}

export interface Expense {
  id: string;
  project_id: string | null;
  category: CostCategory;
  description: string;
  expense_date: string;
  amount_excl: Cents;
  amount_total: Cents;
  settlement: "payable" | "payroll";
  supplier_id: string | null;
  subcontractor_id: string | null;
  employee_id: string | null;
  hours: number | null;
}

export interface Payment {
  id: string;
  direction: "in" | "out";
  amount: Cents;
  payment_date: string;
  invoice_id: string | null;
  expense_id: string | null;
  obligation_id: string | null;
  project_id: string | null;
}

export interface Obligation {
  id: string;
  kind: string;
  label: string;
  counterparty: string | null;
  amount: Cents;
  frequency: "once" | "monthly" | "quarterly" | "yearly";
  next_due_date: string;
  end_date: string | null;
  active: boolean;
}

export interface BankBalance {
  account_label: string;
  balance: Cents;
  as_of: string;
  source: string;
}

export interface ChangeOrder {
  id: string;
  project_id: string;
  description: string;
  amount_excl: Cents | null;
  status: "requested" | "quoted" | "approved" | "rejected";
  work_started: boolean;
  requested_on: string;
}

export interface Party {
  id: string;
  name: string;
  email: string | null;
  kind: "client" | "supplier" | "subcontractor";
  insurance_valid_until?: string | null;
}

export interface Task {
  id: string;
  title: string;
  project_id: string | null;
  status: "todo" | "in_progress" | "waiting" | "completed" | "cancelled";
  priority: "low" | "normal" | "high" | "urgent";
  due_date: string | null;
  assigned_to: string | null;
  source: "manual" | "ai" | "import";
}

export interface DocumentRef {
  project_id: string | null;
  category: string;
}

export interface CompanyData {
  projects: Project[];
  invoices: Invoice[];
  expenses: Expense[];
  payments: Payment[];
  obligations: Obligation[];
  bankBalances: BankBalance[];
  changeOrders: ChangeOrder[];
  clients: Party[];
  suppliers: Party[];
  subcontractors: Party[];
  tasks: Task[];
  documents: DocumentRef[];
}
