/**
 * Import / export CSV.
 * - Export : séparateur « ; » et virgule décimale (Excel en français/belge), UTF-8 avec BOM.
 * - Import : « ; » ou « , » détectés ; dates AAAA-MM-JJ ou JJ/MM/AAAA ; montants « 1 234,56 » ou « 1234.56 ».
 *   Chaque ligne est validée (Zod) ; aucune ligne n'est écrite tant qu'une seule erreur subsiste.
 */
import Papa from "papaparse";
import { z } from "zod";

export type ImportKind = "projects" | "invoices" | "expenses";

export const TEMPLATES: Record<ImportKind, string[]> = {
  projects: ["reference", "name", "client_name", "client_email", "site_address", "status", "contract_amount_excl", "vat_rate", "start_date",
    "planned_end_date", "progress_pct", "budget_materials", "budget_labour", "budget_subcontract", "budget_other", "architect_name"],
  invoices: ["direction", "number", "kind", "client_name", "supplier_name", "project_reference", "cost_category", "issue_date", "due_date",
    "amount_excl", "vat_rate", "status", "paid_amount", "paid_date"],
  expenses: ["description", "category", "project_reference", "expense_date", "hours", "amount_excl", "vat_rate", "settlement", "employee_name"],
};
export const EXAMPLES: Record<ImportKind, string[]> = {
  projects: ["MAD-2026-030", "Rénovation façade", "Client Exemple", "client@exemple.test", "Rue Exemple 1, 1000 Bruxelles", "signed", "85000", "6",
    "2026-11-15", "2027-03-31", "", "25000", "30000", "15000", "2000", ""],
  invoices: ["issued", "F2026-0300", "advance", "Client Exemple", "", "MAD-2026-030", "", "2026-11-15", "2026-12-15", "25500", "6", "issued", "", ""],
  expenses: ["Équipe maçonnerie semaine 46", "labour", "MAD-2026-030", "2026-11-20", "120", "5400", "0", "payroll", ""],
};

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : typeof v === "string" ? v.trim() : v);
export function normDate(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const s = v.trim();
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : s;
}
export function normAmount(v: unknown): unknown {
  if (typeof v !== "string") return v;
  let s = v.replace(/[\s €]/g, "");
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(",", ".");
  return s;
}
const date = z.preprocess((v) => normDate(blank(v)), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date invalide (AAAA-MM-JJ ou JJ/MM/AAAA)"));
const optDate = z.preprocess((v) => normDate(blank(v)), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date invalide").optional());
const amount = z.preprocess((v) => normAmount(blank(v)), z.coerce.number({ message: "montant invalide" }).finite().min(0, "montant négatif"));
const optAmount = z.preprocess((v) => normAmount(blank(v)), amount.optional());
const vat = z.preprocess((v) => normAmount(blank(v)), z.coerce.number().refine((x) => [0, 6, 12, 21].includes(x), "TVA : 0, 6, 12 ou 21"));
const str = (max: number) => z.preprocess(blank, z.string().min(1, "obligatoire").max(max));
const optStr = (max: number) => z.preprocess(blank, z.string().max(max).optional());
const CATS = ["materials", "labour", "subcontract", "equipment", "transport", "overhead", "other"] as const;

export const ROW_SCHEMAS = {
  projects: z.object({
    reference: str(50), name: str(200), client_name: optStr(200), client_email: z.preprocess(blank, z.email("e-mail invalide").optional()), site_address: optStr(500),
    status: z.preprocess(blank, z.enum(["offer", "signed", "in_progress", "on_hold", "completed", "handed_over", "cancelled"]).default("offer")),
    contract_amount_excl: optAmount, vat_rate: z.preprocess(blank, vat.optional()), start_date: optDate, planned_end_date: optDate,
    progress_pct: z.preprocess((v) => normAmount(blank(v)), z.coerce.number().min(0).max(100).optional()),
    budget_materials: optAmount, budget_labour: optAmount, budget_subcontract: optAmount, budget_other: optAmount, architect_name: optStr(200),
  }),
  invoices: z.object({
    direction: z.preprocess(blank, z.enum(["issued", "received"], { message: "direction : issued ou received" })), number: str(50),
    kind: z.preprocess(blank, z.enum(["advance", "progress", "final", "credit_note", "standard"]).default("standard")),
    client_name: optStr(200), supplier_name: optStr(200), project_reference: optStr(50), cost_category: z.preprocess(blank, z.enum(CATS).optional()),
    issue_date: date, due_date: date, amount_excl: amount, vat_rate: vat, status: optStr(20), paid_amount: optAmount, paid_date: optDate,
  }).superRefine((r, ctx) => {
    if (r.direction === "issued" && !r.client_name) ctx.addIssue({ code: "custom", path: ["client_name"], message: "client obligatoire pour une facture émise" });
    if (r.direction === "received" && !r.supplier_name) ctx.addIssue({ code: "custom", path: ["supplier_name"], message: "fournisseur obligatoire pour une facture reçue" });
    if (r.direction === "received" && !r.cost_category) ctx.addIssue({ code: "custom", path: ["cost_category"], message: "poste de coût obligatoire" });
    if (r.due_date < r.issue_date) ctx.addIssue({ code: "custom", path: ["due_date"], message: "échéance avant la date d'émission" });
    if (r.paid_amount && !r.paid_date) ctx.addIssue({ code: "custom", path: ["paid_date"], message: "date de paiement requise si un montant payé est indiqué" });
  }),
  expenses: z.object({
    description: str(300), category: z.preprocess(blank, z.enum(CATS)), project_reference: optStr(50), expense_date: date,
    hours: z.preprocess((v) => normAmount(blank(v)), z.coerce.number().min(0).optional()), amount_excl: amount,
    vat_rate: z.preprocess(blank, vat.default(0)), settlement: z.preprocess(blank, z.enum(["payable", "payroll"]).default("payable")), employee_name: optStr(200),
  }),
} as const;

export interface RowError { row: number; field: string; message: string }
export interface ParsedImport<T> { rows: Array<{ line: number; data: T }>; errors: RowError[]; headerErrors: string[] }

export function parseCsv<K extends ImportKind>(kind: K, text: string): ParsedImport<z.infer<(typeof ROW_SCHEMAS)[K]>> {
  const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim().toLowerCase() });
  const headerErrors: string[] = [];
  const fields = res.meta.fields ?? [];
  const required = { projects: ["reference", "name"], invoices: ["direction", "number", "issue_date", "due_date", "amount_excl", "vat_rate"], expenses: ["description", "category", "expense_date", "amount_excl"] }[kind];
  for (const r of required) if (!fields.includes(r)) headerErrors.push(`Colonne obligatoire manquante : ${r}`);
  const unknown = fields.filter((f) => !TEMPLATES[kind].includes(f));
  if (unknown.length) headerErrors.push(`Colonnes inconnues (corrigez ou supprimez-les) : ${unknown.join(", ")}`);
  const rows: ParsedImport<z.infer<(typeof ROW_SCHEMAS)[K]>>["rows"] = [];
  const errors: RowError[] = [];
  for (const e of res.errors) errors.push({ row: (e.row ?? 0) + 2, field: "-", message: e.message });
  res.data.forEach((raw, i) => {
    const line = i + 2; // ligne 1 = en-têtes
    const parsed = ROW_SCHEMAS[kind].safeParse(raw);
    if (parsed.success) rows.push({ line, data: parsed.data as never });
    else for (const iss of parsed.error.issues) errors.push({ row: line, field: iss.path.join(".") || "-", message: iss.message });
  });
  return { rows, errors, headerErrors };
}

export function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const cell = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" ? String(v).replace(".", ",") : v;
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [headers, ...rows].map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}
