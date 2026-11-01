"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbError, makeAction, nullify, type ActionState } from "@/lib/actions";
import { requirePermission, requireUser } from "@/lib/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  bankBalanceSchema, changeOrderSchema, clientSchema, employeeSchema, expenseSchema, issuedInvoiceSchema, obligationSchema,
  paymentSchema, projectSchema, receivedInvoiceSchema, subcontractorSchema, supplierSchema, taskSchema, vatAmount,
} from "@/lib/validation";

const idOf = (fd: FormData) => {
  const id = String(fd.get("$id") ?? fd.get("id") ?? "");
  return /^[0-9a-f-]{36}$/.test(id) ? id : null;
};

// ----------------------------------------------------------------------------- chantiers
export const saveProject = makeAction("projects.write", projectSchema, async (input, { sb, fd }) => {
  const id = idOf(fd);
  const row = nullify(input);
  const q = id ? sb.from("projects").update(row).eq("id", id).select("id").single() : sb.from("projects").insert(row).select("id").single();
  const { data, error } = await q;
  if (error) return { ok: false, error: dbError(error) };
  revalidatePath("/projects");
  revalidatePath("/dashboard");
  return { ok: true, message: "Chantier enregistré", id: data.id };
});

export async function setProjectArchived(id: string, archived: boolean): Promise<ActionState> {
  await requirePermission("projects.write");
  const sb = await createClient();
  const { error } = await sb.from("projects").update({ archived_at: archived ? new Date().toISOString() : null }).eq("id", z.uuid().parse(id));
  if (error) return { ok: false, error: dbError(error) };
  revalidatePath("/projects");
  return { ok: true, message: archived ? "Chantier archivé" : "Chantier restauré" };
}

export async function updateProgress(id: string, progress: number): Promise<ActionState> {
  await requireUser();
  const sb = await createClient();
  const p = z.number().min(0).max(100).parse(progress);
  const { error } = await sb.rpc("update_project_progress", { p_project: z.uuid().parse(id), p_progress: p });
  if (error) return { ok: false, error: dbError(error) };
  revalidatePath(`/projects/${id}`);
  return { ok: true, message: "Avancement mis à jour" };
}

export const saveChangeOrder = makeAction("projects.write", changeOrderSchema, async (input, { sb, fd }) => {
  const id = idOf(fd);
  const row = nullify(input);
  const { error } = id ? await sb.from("change_orders").update(row).eq("id", id) : await sb.from("change_orders").insert(row);
  if (error) return { ok: false, error: dbError(error) };
  revalidatePath(`/projects/${input.project_id}`);
});

export async function setProjectMember(projectId: string, profileId: string, add: boolean): Promise<ActionState> {
  await requirePermission("projects.write");
  const sb = await createClient();
  const pid = z.uuid().parse(projectId), uid = z.uuid().parse(profileId);
  const { error } = add
    ? await sb.from("project_members").insert({ project_id: pid, profile_id: uid })
    : await sb.from("project_members").delete().eq("project_id", pid).eq("profile_id", uid);
  if (error) return { ok: false, error: dbError(error) };
  revalidatePath(`/projects/${pid}`);
  return { ok: true };
}

// ----------------------------------------------------------------------------- tiers & employés
function partyAction(table: "clients" | "suppliers" | "subcontractors", perm: "clients.write" | "suppliers.write", schema: z.ZodType) {
  return makeAction(perm, schema, async (input, { sb, fd }) => {
    const id = idOf(fd);
    const row = nullify(input as Record<string, unknown>);
    const { error } = id ? await sb.from(table).update(row).eq("id", id) : await sb.from(table).insert(row);
    if (error) return { ok: false, error: dbError(error) };
    revalidatePath(`/${table}`);
  });
}
export const saveClient = partyAction("clients", "clients.write", clientSchema);
export const saveSupplier = partyAction("suppliers", "suppliers.write", supplierSchema);
export const saveSubcontractor = partyAction("subcontractors", "suppliers.write", subcontractorSchema);
export const saveEmployee = makeAction("employees.write", employeeSchema, async (input, { sb, fd }) => {
  const id = idOf(fd);
  const row = nullify(input);
  const { error } = id ? await sb.from("employees").update(row).eq("id", id) : await sb.from("employees").insert(row);
  if (error) return { ok: false, error: dbError(error) };
  revalidatePath("/employees");
});

export async function setPartyArchived(table: "clients" | "suppliers" | "subcontractors", id: string, archived: boolean): Promise<ActionState> {
  await requirePermission(table === "clients" ? "clients.write" : "suppliers.write");
  const sb = await createClient();
  const { error } = await sb.from(z.enum(["clients", "suppliers", "subcontractors"]).parse(table))
    .update({ archived_at: archived ? new Date().toISOString() : null }).eq("id", z.uuid().parse(id));
  if (error) return { ok: false, error: dbError(error) };
  revalidatePath(`/${table}`);
  return { ok: true };
}

// ----------------------------------------------------------------------------- finances
export const saveIssuedInvoice = makeAction("finance.write", issuedInvoiceSchema, async (input, { sb, fd }) => {
  const id = idOf(fd);
  const row = { ...nullify(input), direction: "issued", vat_amount: vatAmount(input.amount_excl, input.vat_rate) };
  const { error } = id ? await sb.from("invoices").update(row).eq("id", id) : await sb.from("invoices").insert(row);
  if (error) return { ok: false, error: dbError(error) };
  revalidatePath("/financial");
});

export const saveReceivedInvoice = makeAction("finance.write", receivedInvoiceSchema, async (input, { sb, fd }) => {
  const id = idOf(fd);
  const [kind, partyId] = input.party.split(":");
  const { party: _p, ...rest } = input;
  void _p;
  const row = {
    ...nullify(rest), direction: "received", vat_amount: vatAmount(input.amount_excl, input.vat_rate),
    supplier_id: kind === "supplier" ? partyId : null, subcontractor_id: kind === "subcontractor" ? partyId : null,
  };
  const { error } = id ? await sb.from("invoices").update(row).eq("id", id) : await sb.from("invoices").insert(row);
  if (error) return { ok: false, error: dbError(error) };
  revalidatePath("/financial");
});

export const saveExpense = makeAction("expenses.write", expenseSchema, async (input, { sb }) => {
  const { paid_now, ...rest } = input;
  const row = { ...nullify(rest), vat_amount: vatAmount(input.amount_excl, input.vat_rate) };
  const { data, error } = await sb.from("expenses").insert(row).select("id, amount_total").single();
  if (error) return { ok: false, error: dbError(error) };
  if (paid_now && input.settlement === "payable") {
    const { error: pe } = await sb.from("payments").insert({ direction: "out", amount: data.amount_total, payment_date: input.expense_date, expense_id: data.id, method: "card" });
    if (pe) return { ok: false, error: `Dépense enregistrée, mais paiement refusé : ${dbError(pe)}` };
  }
  revalidatePath("/financial");
});

export const savePayment = makeAction("finance.write", paymentSchema, async (input, { sb }) => {
  const { error } = await sb.from("payments").insert(nullify(input));
  if (error) return { ok: false, error: dbError(error) };
  revalidatePath("/financial");
  revalidatePath("/dashboard");
  return { ok: true, message: "Paiement enregistré" };
});

export const saveBankBalance = makeAction("bank.write", bankBalanceSchema, async (input, { sb }) => {
  const { error } = await sb.from("bank_balances").upsert({ ...input, source: "manual" }, { onConflict: "account_label,as_of" });
  if (error) return { ok: false, error: dbError(error) };
  revalidatePath("/financial");
  revalidatePath("/dashboard");
});

export const saveObligation = makeAction("bank.write", obligationSchema, async (input, { sb, fd }) => {
  const id = idOf(fd);
  const row = nullify(input);
  const { error } = id ? await sb.from("recurring_obligations").update(row).eq("id", id) : await sb.from("recurring_obligations").insert(row);
  if (error) return { ok: false, error: dbError(error) };
  revalidatePath("/financial");
});

/** Confirme le paiement de l'échéance courante d'une obligation : enregistre le paiement et passe à l'échéance suivante. */
export async function confirmObligationPaid(id: string, paymentDate: string): Promise<ActionState> {
  await requirePermission("bank.write");
  const sb = await createClient();
  const { data: o, error } = await sb.from("recurring_obligations").select("*").eq("id", z.uuid().parse(id)).single();
  if (error || !o) return { ok: false, error: dbError(error) };
  const { error: pe } = await sb.from("payments").insert({ direction: "out", amount: o.amount, payment_date: z.iso.date().parse(paymentDate), obligation_id: o.id, method: "direct_debit", reference: `${o.label} – échéance ${o.next_due_date}` });
  if (pe) return { ok: false, error: dbError(pe) };
  const { addMonths } = await import("@/lib/dates");
  const step = { monthly: 1, quarterly: 3, yearly: 12 } as Record<string, number>;
  const next = o.frequency === "once" ? null : addMonths(o.next_due_date, step[o.frequency]);
  const upd = next && (!o.end_date || next <= o.end_date) ? { next_due_date: next } : { active: false };
  const { error: ue } = await sb.from("recurring_obligations").update(upd).eq("id", o.id);
  if (ue) return { ok: false, error: dbError(ue) };
  revalidatePath("/financial");
  return { ok: true, message: "Échéance confirmée" };
}

// ----------------------------------------------------------------------------- tâches
export const saveTask = makeAction("tasks.write", taskSchema, async (input, { sb, fd }) => {
  const id = idOf(fd);
  const row = nullify(input);
  const { error } = id ? await sb.from("tasks").update(row).eq("id", id) : await sb.from("tasks").insert({ ...row, source: "manual" });
  if (error) return { ok: false, error: dbError(error) };
  revalidatePath("/tasks");
});

export async function setTaskStatus(id: string, status: string): Promise<ActionState> {
  await requireUser();
  const sb = await createClient();
  const s = z.enum(["todo", "in_progress", "waiting", "completed", "cancelled"]).parse(status);
  const { data, error } = await sb.from("tasks").update({ status: s }).eq("id", z.uuid().parse(id)).select("id");
  if (error) return { ok: false, error: dbError(error) };
  if (!data?.length) return { ok: false, error: "Tâche introuvable ou non autorisée." };
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  return { ok: true };
}

// ----------------------------------------------------------------------------- approbations & alertes
export async function decideApproval(id: string, approve: boolean, note?: string | null): Promise<ActionState> {
  await requirePermission("approvals.decide");
  const sb = await createClient();
  const { error } = await sb.rpc("decide_approval", { p_id: z.uuid().parse(id), p_approve: approve, p_note: note?.slice(0, 1000) || null });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/approvals");
  return { ok: true, message: approve ? "Demande approuvée" : "Demande refusée" };
}

export async function recordExecution(id: string, success: boolean, result?: string): Promise<ActionState> {
  await requirePermission("approvals.decide");
  const sb = await createClient();
  const { error } = await sb.rpc("record_approval_execution", { p_id: z.uuid().parse(id), p_success: success, p_result: (result ?? "").slice(0, 2000) });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/approvals");
  return { ok: true };
}

export async function acknowledgeAlert(id: string): Promise<ActionState> {
  await requireUser();
  const sb = await createClient();
  const { error } = await sb.from("alerts").update({ status: "acknowledged" }).eq("id", z.uuid().parse(id));
  if (error) return { ok: false, error: dbError(error) };
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function runAnalysisNow(weekly = false): Promise<ActionState> {
  const user = await requirePermission("analysis.run");
  const { runAnalysis } = await import("@/lib/analysis/engine");
  try {
    const r = await runAnalysis({ trigger: "manual", userId: user.id, weekly });
    revalidatePath("/dashboard");
    return { ok: true, message: `Analyse terminée : ${r.findings} constats, ${r.newAlerts} nouvelles alertes, ${r.tasksCreated} tâches, ${r.remindersPrepared} rappels à approuver.` };
  } catch (e) {
    return { ok: false, error: `Échec de l'analyse : ${e instanceof Error ? e.message : e}` };
  }
}

// ----------------------------------------------------------------------------- documents
export async function deleteDocument(id: string): Promise<ActionState> {
  await requirePermission("documents.write");
  const sb = await createClient();
  const { data: doc } = await sb.from("documents").select("storage_path").eq("id", z.uuid().parse(id)).single();
  if (!doc) return { ok: false, error: "Document introuvable." };
  const { error } = await sb.from("documents").delete().eq("id", id);
  if (error) return { ok: false, error: dbError(error) };
  await sb.storage.from("documents").remove([doc.storage_path]);
  revalidatePath("/documents");
  return { ok: true };
}

// ----------------------------------------------------------------------------- paramètres
export async function setLocale(locale: string): Promise<ActionState> {
  const user = await requireUser();
  const sb = await createClient();
  const { error } = await sb.from("profiles").update({ locale: z.enum(["fr", "ro"]).parse(locale) }).eq("id", user.id);
  if (error) return { ok: false, error: dbError(error) };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setUserRole(profileId: string, role: string, active: boolean): Promise<ActionState> {
  await requirePermission("settings.users");
  const sb = await createClient();
  const { error } = await sb.from("profiles").update({
    role: z.enum(["owner", "admin", "finance", "project_manager", "site_manager", "employee"]).parse(role), active,
  }).eq("id", z.uuid().parse(profileId));
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true, message: "Rôle mis à jour" };
}

const newUserSchema = z.object({
  email: z.email(), full_name: z.string().trim().min(2).max(200),
  role: z.enum(["owner", "admin", "finance", "project_manager", "site_manager", "employee"]),
  password: z.string().min(12, "12 caractères minimum").max(200),
});
/** Création d'un compte par l'OWNER (les inscriptions publiques sont désactivées). */
export const createUser = makeAction("settings.users", newUserSchema, async (input) => {
  const admin = createServiceClient();
  const { data, error } = await admin.auth.admin.createUser({ email: input.email, password: input.password, email_confirm: true, user_metadata: { full_name: input.full_name } });
  if (error) return { ok: false, error: error.message };
  const sb = await createClient(); // le changement de rôle passe par la session de l'OWNER (contrôle en base)
  const { error: re } = await sb.from("profiles").update({ role: input.role, full_name: input.full_name }).eq("id", data.user.id);
  if (re) return { ok: false, error: re.message };
  revalidatePath("/settings");
  return { ok: true, message: "Utilisateur créé" };
});
