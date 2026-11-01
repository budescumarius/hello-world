"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbError } from "@/lib/actions";
import { requirePermission } from "@/lib/auth";
import { type ImportKind, parseCsv, type RowError } from "@/lib/csv";
import { createClient } from "@/lib/supabase/server";
import { vatAmount } from "@/lib/validation";

export interface ImportPreview {
  ok: boolean; kind: ImportKind; valid: number; total: number; errors: RowError[]; headerErrors: string[]; notes: string[]; committed?: number; error?: string;
}
const MAX_BYTES = 2_000_000, MAX_ROWS = 5000;

/** Valide le fichier ET résout les références (clients, fournisseurs, chantiers) ; n'écrit rien si `commit` est faux. */
async function run(kind: ImportKind, text: string, commit: boolean): Promise<ImportPreview> {
  await requirePermission("import.run");
  if (text.length > MAX_BYTES) return { ok: false, kind, valid: 0, total: 0, errors: [], headerErrors: ["Fichier trop volumineux (2 Mo max)."], notes: [] };
  const sb = await createClient();
  const parsed = parseCsv(kind, text);
  const errors = [...parsed.errors];
  const notes: string[] = [];
  if (parsed.rows.length + new Set(parsed.errors.map((e) => e.row)).size > MAX_ROWS) parsed.headerErrors.push(`Maximum ${MAX_ROWS} lignes par import.`);

  const [{ data: projects }, { data: clients }, { data: suppliers }, { data: subs }, { data: employees }] = await Promise.all([
    sb.from("projects").select("id, reference"), sb.from("clients").select("id, name"), sb.from("suppliers").select("id, name"),
    sb.from("subcontractors").select("id, name"), sb.from("employees").select("id, full_name"),
  ]);
  const byName = <T extends { id: string }>(rows: T[] | null, key: keyof T) => new Map((rows ?? []).map((r) => [String(r[key]).toLowerCase(), r.id]));
  const P = byName(projects, "reference"), C = byName(clients, "name"), S = byName(suppliers, "name"), ST = byName(subs, "name"), E = byName(employees, "full_name");
  const seen = new Set<string>();
  const newClients = new Set<string>();
  const out: Array<{ line: number; row: Record<string, unknown>; payment?: { amount: number; date: string } }> = [];

  for (const { line, data } of parsed.rows as Array<{ line: number; data: Record<string, unknown> }>) {
    const err = (field: string, message: string) => errors.push({ row: line, field, message });
    const projectId = (ref: unknown) => {
      if (!ref) return null;
      const id = P.get(String(ref).toLowerCase());
      if (!id) err("project_reference", `chantier inconnu : ${ref}`);
      return id ?? null;
    };
    if (kind === "projects") {
      const ref = String(data.reference);
      if (P.has(ref.toLowerCase())) err("reference", `le chantier ${ref} existe déjà`);
      if (seen.has(ref)) err("reference", `référence en double dans le fichier`);
      seen.add(ref);
      if (data.client_name && !C.has(String(data.client_name).toLowerCase())) newClients.add(String(data.client_name));
      const { client_name: _c, client_email: _e, ...rest } = data;
      void _c; void _e;
      out.push({ line, row: { ...rest, client_name: data.client_name, client_email: data.client_email } });
    } else if (kind === "invoices") {
      const key = `${data.direction}:${data.supplier_name ?? ""}:${data.number}`;
      if (seen.has(key)) err("number", "facture en double dans le fichier");
      seen.add(key);
      const row: Record<string, unknown> = {
        direction: data.direction, number: data.number, kind: data.kind, project_id: projectId(data.project_reference), issue_date: data.issue_date,
        due_date: data.due_date, amount_excl: data.amount_excl, vat_rate: data.vat_rate, vat_amount: vatAmount(Number(data.amount_excl), Number(data.vat_rate)), source: "import",
      };
      if (data.direction === "issued") {
        row.client_id = C.get(String(data.client_name).toLowerCase()) ?? null;
        if (!row.client_id) err("client_name", `client inconnu : ${data.client_name} (créez-le d'abord)`);
        row.status = data.status ?? "issued";
        if (!["draft", "issued", "disputed", "cancelled"].includes(String(row.status))) err("status", "statut invalide pour une facture émise");
      } else {
        const n = String(data.supplier_name).toLowerCase();
        row.supplier_id = S.get(n) ?? null;
        row.subcontractor_id = row.supplier_id ? null : ST.get(n) ?? null;
        if (!row.supplier_id && !row.subcontractor_id) err("supplier_name", `fournisseur / sous-traitant inconnu : ${data.supplier_name}`);
        row.cost_category = data.cost_category;
        row.status = data.status ?? "received";
        if (!["received", "approved", "disputed", "cancelled"].includes(String(row.status))) err("status", "statut invalide pour une facture reçue");
      }
      const total = Number(data.amount_excl) + Number(row.vat_amount);
      if (data.paid_amount && Number(data.paid_amount) > total + 0.001) err("paid_amount", "montant payé supérieur au total TVAC");
      out.push({ line, row, payment: data.paid_amount ? { amount: Number(data.paid_amount), date: String(data.paid_date) } : undefined });
    } else {
      const row: Record<string, unknown> = {
        description: data.description, category: data.category, project_id: projectId(data.project_reference), expense_date: data.expense_date,
        hours: data.hours ?? null, amount_excl: data.amount_excl, vat_rate: data.vat_rate, vat_amount: vatAmount(Number(data.amount_excl), Number(data.vat_rate)),
        settlement: data.settlement, source: "import",
      };
      if (data.employee_name) {
        row.employee_id = E.get(String(data.employee_name).toLowerCase()) ?? null;
        if (!row.employee_id) err("employee_name", `employé inconnu : ${data.employee_name}`);
      }
      out.push({ line, row });
    }
  }
  if (newClients.size) notes.push(`Clients qui seront créés : ${[...newClients].join(", ")}`);
  const total = parsed.rows.length + new Set(parsed.errors.map((e) => e.row)).size;
  const errorRows = new Set(errors.map((e) => e.row));
  const preview: ImportPreview = { ok: !errors.length && !parsed.headerErrors.length && out.length > 0, kind, valid: out.filter((o) => !errorRows.has(o.line)).length,
    total, errors: errors.sort((a, b) => a.row - b.row), headerErrors: parsed.headerErrors, notes };
  if (!commit || !preview.ok) return preview;

  // --- écriture (uniquement si 0 erreur)
  if (kind === "projects") {
    for (const name of newClients) {
      const email = out.find((o) => o.row.client_name === name)?.row.client_email;
      const { data: c, error } = await sb.from("clients").insert({ name, email: email ?? null }).select("id").single();
      if (error) return { ...preview, ok: false, error: dbError(error) };
      C.set(name.toLowerCase(), c.id);
    }
    const rows = out.map(({ row }) => {
      const { client_name, client_email: _e, ...rest } = row;
      void _e;
      return { ...rest, client_id: client_name ? C.get(String(client_name).toLowerCase()) ?? null : null };
    });
    const { error } = await sb.from("projects").insert(rows); // une seule requête = tout ou rien
    if (error) return { ...preview, ok: false, error: dbError(error) };
  } else if (kind === "invoices") {
    const { data: inserted, error } = await sb.from("invoices").insert(out.map((o) => o.row)).select("id, number, direction");
    if (error) return { ...preview, ok: false, error: dbError(error) };
    const pays = out.flatMap((o, i) => o.payment ? [{ direction: o.row.direction === "issued" ? "in" : "out", invoice_id: inserted[i].id, amount: o.payment.amount, payment_date: o.payment.date, source: "import", reference: "Import CSV" }] : []);
    if (pays.length) {
      const { error: pe } = await sb.from("payments").insert(pays);
      if (pe) return { ...preview, ok: false, error: `Factures importées, mais paiements refusés : ${dbError(pe)}` };
    }
  } else {
    const { error } = await sb.from("expenses").insert(out.map((o) => o.row));
    if (error) return { ...preview, ok: false, error: dbError(error) };
  }
  revalidatePath("/", "layout");
  return { ...preview, committed: out.length };
}

const input = z.object({ kind: z.enum(["projects", "invoices", "expenses"]), text: z.string() });
export async function previewImport(kind: string, text: string) {
  const p = input.parse({ kind, text });
  return run(p.kind, p.text, false);
}
export async function commitImport(kind: string, text: string) {
  const p = input.parse({ kind, text });
  return run(p.kind, p.text, true);
}
