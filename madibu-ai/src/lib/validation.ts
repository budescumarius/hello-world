import { z } from "zod";

/** Schémas Zod partagés (formulaires, import CSV, outils IA). Montants saisis en euros décimaux. */
const emptyToUndef = (v: unknown) => (v === "" || v === null ? undefined : v);
const optStr = (max = 500) => z.preprocess(emptyToUndef, z.string().trim().max(max).optional());
const reqStr = (max = 300) => z.string().trim().min(1, "Champ obligatoire").max(max);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date au format AAAA-MM-JJ");
const optDate = z.preprocess(emptyToUndef, isoDate.optional());
const euros = z.preprocess((v) => (typeof v === "string" ? v.replace(/\s/g, "").replace(",", ".") : v),
  z.coerce.number({ message: "Montant invalide" }).finite().min(0, "Montant négatif").max(999_999_999));
const optEuros = z.preprocess(emptyToUndef, euros.optional());
const posEuros = euros.refine((v) => v > 0, "Le montant doit être positif");
const vatRate = z.coerce.number().refine((v) => [0, 6, 12, 21].includes(v), "TVA autorisée : 0, 6, 12 ou 21 %");
const optUuid = z.preprocess(emptyToUndef, z.uuid().optional());
const optEmail = z.preprocess(emptyToUndef, z.email("E-mail invalide").optional());

export const projectSchema = z.object({
  reference: reqStr(50), name: reqStr(200), client_id: optUuid, site_address: optStr(),
  architect_name: optStr(200), architect_email: optEmail, architect_phone: optStr(50), engineer_name: optStr(200), engineer_email: optEmail,
  status: z.enum(["offer", "signed", "in_progress", "on_hold", "completed", "handed_over", "cancelled"]),
  contract_amount_excl: optEuros, vat_rate: z.preprocess(emptyToUndef, vatRate.optional()),
  start_date: optDate, planned_end_date: optDate, actual_end_date: optDate,
  progress_pct: z.preprocess(emptyToUndef, z.coerce.number().min(0).max(100).optional()),
  budget_materials: optEuros, budget_labour: optEuros, budget_subcontract: optEuros, budget_other: optEuros,
  forecast_cost_override: optEuros, project_manager_id: optUuid, site_manager_id: optUuid, notes: optStr(4000),
}).refine((p) => !p.start_date || !p.planned_end_date || p.planned_end_date >= p.start_date, { message: "La fin prévue précède le début", path: ["planned_end_date"] });

export const clientSchema = z.object({
  name: reqStr(200), client_type: z.enum(["company", "individual", "public"]).default("company"), vat_number: optStr(30),
  email: optEmail, phone: optStr(50), address: optStr(), contact_person: optStr(200),
  payment_terms_days: z.preprocess(emptyToUndef, z.coerce.number().int().min(0).max(180).optional()), notes: optStr(4000),
});
export const supplierSchema = z.object({
  name: reqStr(200), vat_number: optStr(30), email: optEmail, phone: optStr(50), address: optStr(), contact_person: optStr(200),
  categories: z.preprocess((v) => (typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : v ?? []), z.array(z.string().max(60)).max(20)),
  payment_terms_days: z.preprocess(emptyToUndef, z.coerce.number().int().min(0).max(180).optional()), notes: optStr(4000),
});
export const subcontractorSchema = z.object({
  name: reqStr(200), trade: optStr(100), vat_number: optStr(30), email: optEmail, phone: optStr(50), address: optStr(), contact_person: optStr(200),
  payment_terms_days: z.preprocess(emptyToUndef, z.coerce.number().int().min(0).max(180).optional()), insurance_valid_until: optDate, notes: optStr(4000),
});
export const employeeSchema = z.object({
  full_name: reqStr(200), job_title: optStr(100), email: optEmail, phone: optStr(50), hourly_cost: optEuros, hired_on: optDate,
  active: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()), notes: optStr(4000),
});

export const issuedInvoiceSchema = z.object({
  number: reqStr(50), kind: z.enum(["advance", "progress", "final", "credit_note", "standard"]), project_id: optUuid, client_id: z.uuid("Client requis"),
  issue_date: isoDate, due_date: isoDate, amount_excl: euros, vat_rate: vatRate, status: z.enum(["draft", "issued", "disputed", "cancelled"]).default("issued"),
  notes: optStr(2000),
}).refine((i) => i.due_date >= i.issue_date, { message: "L'échéance précède la date d'émission", path: ["due_date"] });

export const receivedInvoiceSchema = z.object({
  number: reqStr(50), party: z.string().regex(/^(supplier|subcontractor):[0-9a-f-]{36}$/, "Fournisseur ou sous-traitant requis"),
  project_id: optUuid, cost_category: z.enum(["materials", "labour", "subcontract", "equipment", "transport", "overhead", "other"]),
  issue_date: isoDate, due_date: isoDate, amount_excl: euros, vat_rate: vatRate,
  status: z.enum(["received", "approved", "disputed", "cancelled"]).default("received"), notes: optStr(2000),
}).refine((i) => i.due_date >= i.issue_date, { message: "L'échéance précède la date d'émission", path: ["due_date"] });

export const expenseSchema = z.object({
  description: reqStr(300), category: z.enum(["materials", "labour", "subcontract", "equipment", "transport", "overhead", "other"]),
  project_id: optUuid, employee_id: optUuid, expense_date: isoDate,
  hours: z.preprocess(emptyToUndef, z.coerce.number().min(0).max(10000).optional()), amount_excl: euros, vat_rate: vatRate.default(0),
  settlement: z.enum(["payable", "payroll"]).default("payable"),
  paid_now: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()).default(false),
});

export const paymentSchema = z.object({
  direction: z.enum(["in", "out"]), amount: posEuros, payment_date: isoDate,
  invoice_id: optUuid, expense_id: optUuid, obligation_id: optUuid,
  method: z.enum(["bank_transfer", "direct_debit", "card", "cash", "other"]).default("bank_transfer"), reference: optStr(100), notes: optStr(1000),
});

export const bankBalanceSchema = z.object({ account_label: reqStr(100), balance: z.preprocess((v) => (typeof v === "string" ? v.replace(",", ".") : v), z.coerce.number().finite()), as_of: isoDate });

export const obligationSchema = z.object({
  kind: z.enum(["loan", "credit_facility", "leasing", "salary", "social_security", "tax", "rent", "insurance", "other"]),
  label: reqStr(200), counterparty: optStr(200), amount: posEuros, frequency: z.enum(["once", "monthly", "quarterly", "yearly"]),
  next_due_date: isoDate, end_date: optDate, notes: optStr(1000),
});

export const changeOrderSchema = z.object({
  project_id: z.uuid(), description: reqStr(500), amount_excl: optEuros, status: z.enum(["requested", "quoted", "approved", "rejected"]),
  work_started: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()), requested_on: isoDate, approved_on: optDate,
}).refine((c) => c.status !== "approved" || !!c.approved_on, { message: "Date d'accord requise pour un avenant approuvé", path: ["approved_on"] });

export const taskSchema = z.object({
  title: reqStr(300), description: optStr(4000), project_id: optUuid, assigned_to: optUuid,
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  status: z.enum(["todo", "in_progress", "waiting", "completed", "cancelled"]).default("todo"), due_date: optDate,
});

export function vatAmount(excl: number, rate: number): number {
  return Math.round(excl * rate) / 100; // euros, arrondi au centime
}

export type FieldErrors = Record<string, string>;
export function flattenErrors(err: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const i of err.issues) out[i.path.join(".") || "_"] ??= i.message;
  return out;
}
export function formToObject(fd: FormData): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) if (!k.startsWith("$")) o[k] = typeof v === "string" ? v : v;
  return o;
}
