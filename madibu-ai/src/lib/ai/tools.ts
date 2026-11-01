import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { allForecasts, companySummary, COMMON_RULES, isActive, payables, projectFinancials, receivables, SCENARIO_RULES } from "../domain/finance";
import type { CompanyData } from "../domain/types";
import { AI_REQUIRES_APPROVAL } from "../permissions";
import { loadCompanyData } from "../data/company";

/**
 * Les fonctions du domaine travaillent en centimes. Avant d'envoyer un résultat au modèle,
 * tout nombre est converti en euros SAUF les champs explicitement non monétaires ci-dessous.
 */
const NON_MONEY = /(Pct|pct)$|^(daysLate|daysOverdue|ageDays|vat_rate|hours|level|activeProjects|unknownContractValues|overdueInvoiceCount|projectsWithoutEstimate|findings)$/;
export function centsToEur(v: unknown, key = ""): unknown {
  if (Array.isArray(v)) return v.map((x) => centsToEur(x, key));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, centsToEur(x, k)]));
  if (typeof v === "number" && !NON_MONEY.test(key)) return Math.round(v) / 100;
  return v;
}
/** Outils renvoyant des lignes de base déjà en euros (numeric) : pas de conversion. */
export const EUR_NATIVE_TOOLS = new Set<string>(["list_alerts", "list_pending_approvals", "create_task", "propose_action"]);

const schemas = {
  get_company_overview: z.object({}).strict(),
  list_projects: z.object({ status: z.enum(["offer", "signed", "in_progress", "on_hold", "completed", "handed_over", "cancelled"]).optional() }).strict(),
  get_project: z.object({ reference: z.string().min(1).max(50) }).strict(),
  list_receivables: z.object({ overdue_only: z.boolean().optional() }).strict(),
  list_payables: z.object({ overdue_only: z.boolean().optional() }).strict(),
  get_cash_forecast: z.object({}).strict(),
  list_alerts: z.object({}).strict(),
  list_tasks: z.object({ overdue_only: z.boolean().optional() }).strict(),
  list_pending_approvals: z.object({}).strict(),
  create_task: z.object({
    title: z.string().min(3).max(300), description: z.string().max(4000).optional(), project_reference: z.string().max(50).optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(), due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).strict(),
  propose_action: z.object({
    action_type: z.enum([...AI_REQUIRES_APPROVAL, "other"]), title: z.string().min(3).max(300), justification: z.string().min(3).max(4000),
    payload: z.record(z.string(), z.unknown()), project_reference: z.string().max(50).optional(),
  }).strict(),
} as const;
export type ToolName = keyof typeof schemas;

function jsonSchema(name: ToolName) {
  const s = z.toJSONSchema(schemas[name]) as Record<string, unknown>;
  delete s.$schema;
  return s as Anthropic.Tool.InputSchema;
}

const DESCRIPTIONS: Record<ToolName, string> = {
  get_company_overview: "Synthèse financière : chantiers actifs, contrats signés, facturé, encaissé, créances, dettes, trésorerie saisie.",
  list_projects: "Liste des chantiers avec indicateurs (contrat, facturé, encaissé, coûts engagés/payés, budget, coût final estimé, marge, retard, données manquantes).",
  get_project: "Fiche détaillée d'un chantier par sa référence (ex. MAD-2026-011) : finances, factures, dépenses, avenants, tâches.",
  list_receivables: "Factures clients non soldées (solde, retard en jours).",
  list_payables: "Factures fournisseurs/sous-traitants et dépenses non réglées.",
  get_cash_forecast: "Prévisions de trésorerie optimiste/réaliste/pessimiste à 7, 30 et 90 jours avec hypothèses.",
  list_alerts: "Alertes ouvertes détectées par les agents d'analyse.",
  list_tasks: "Tâches ouvertes (option : uniquement en retard).",
  list_pending_approvals: "Actions en attente de validation humaine.",
  create_task: "Crée une tâche interne (action autonome autorisée).",
  propose_action: "Dépose une action sensible (e-mail externe, paiement, facture, commande, contrat, engagement…) dans le centre d'approbation. N'exécute RIEN : un humain doit approuver.",
};

export const TOOLS: Anthropic.Tool[] = (Object.keys(schemas) as ToolName[]).map((name) => ({
  name, description: DESCRIPTIONS[name], input_schema: jsonSchema(name),
}));

export class ToolInputError extends Error {}

export interface ToolContext { sb: SupabaseClient; userId: string; today: string; runId: string | null; cache?: CompanyData }

async function data(ctx: ToolContext) {
  ctx.cache ??= await loadCompanyData(ctx.sb);
  return ctx.cache;
}
const isOpenTask = (s: string) => ["todo", "in_progress", "waiting"].includes(s);

export async function executeTool(ctx: ToolContext, name: string, rawInput: unknown): Promise<unknown> {
  if (!(name in schemas)) throw new ToolInputError(`Outil inconnu : ${name}`);
  const parsed = schemas[name as ToolName].safeParse(rawInput ?? {});
  if (!parsed.success) throw new ToolInputError(`Paramètres invalides : ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  const input = parsed.data as Record<string, unknown>;
  const { today } = ctx;

  switch (name as ToolName) {
    case "get_company_overview": {
      const d = await data(ctx);
      return { ...companySummary(d, today), note: "Trésorerie = soldes saisis manuellement (pas de connexion bancaire). Facturé HTVA ≠ encaissé TVAC." };
    }
    case "list_projects": {
      const d = await data(ctx);
      return d.projects.filter((p) => !p.archived_at && (!input.status || p.status === input.status)).map((p) => ({
        reference: p.reference, name: p.name, status: p.status, planned_end_date: p.planned_end_date, ...projectFinancials(p, d, today),
      }));
    }
    case "get_project": {
      const d = await data(ctx);
      const p = d.projects.find((x) => x.reference.toLowerCase() === String(input.reference).toLowerCase());
      if (!p) throw new ToolInputError(`Chantier ${input.reference} introuvable ou non autorisé`);
      return {
        project: p, financials: projectFinancials(p, d, today),
        invoices: d.invoices.filter((i) => i.project_id === p.id).map((i) => ({ number: i.number, direction: i.direction, kind: i.kind, status: i.status, due_date: i.due_date, amount_total: i.amount_total })),
        changeOrders: d.changeOrders.filter((c) => c.project_id === p.id),
        openTasks: d.tasks.filter((t) => t.project_id === p.id && isOpenTask(t.status)).map((t) => ({ title: t.title, due_date: t.due_date, priority: t.priority })),
      };
    }
    case "list_receivables": {
      const d = await data(ctx);
      const names = new Map(d.clients.map((c) => [c.id, c.name]));
      return receivables(d, today).filter((r) => !input.overdue_only || r.daysOverdue > 0)
        .map((r) => ({ number: r.number, client: names.get(r.party_id ?? "") ?? null, due_date: r.due_date, total: r.total, paid: r.paid, open: r.open, daysOverdue: r.daysOverdue, disputed: r.disputed }));
    }
    case "list_payables": {
      const d = await data(ctx);
      const names = new Map([...d.suppliers, ...d.subcontractors].map((c) => [c.id, `${c.name} (${c.kind === "subcontractor" ? "sous-traitant" : "fournisseur"})`]));
      return payables(d, today).filter((r) => !input.overdue_only || r.daysOverdue > 0)
        .map((r) => ({ ref: r.number, party: names.get(r.party_id ?? "") ?? null, due_date: r.due_date, open: r.open, daysOverdue: r.daysOverdue, disputed: r.disputed }));
    }
    case "get_cash_forecast": {
      const d = await data(ctx);
      const fc = allForecasts(d, today);
      return {
        scenarios: Object.fromEntries(Object.entries(fc).map(([k, v]) => [k, { startBalance: v.startBalance, horizons: v.horizons, excludedReceivables: v.excludedReceivables, rules: SCENARIO_RULES[k as keyof typeof SCENARIO_RULES] }])),
        commonRules: COMMON_RULES,
      };
    }
    case "list_alerts": {
      const { data: rows, error } = await ctx.sb.from("alerts").select("severity, category, title, why, impact_amount, recommendation, responsible, due_date").neq("status", "resolved").order("severity").limit(60);
      if (error) throw new Error(error.message);
      return rows; // impact_amount déjà en euros (numeric)
    }
    case "list_tasks": {
      const d = await data(ctx);
      return d.tasks.filter((t) => isOpenTask(t.status) && (!input.overdue_only || (t.due_date !== null && t.due_date < today)))
        .map((t) => ({ title: t.title, priority: t.priority, status: t.status, due_date: t.due_date, source: t.source }));
    }
    case "list_pending_approvals": {
      const { data: rows, error } = await ctx.sb.from("approvals").select("action_type, title, requested_by_ai, created_at").eq("status", "pending").limit(50);
      if (error) throw new Error(error.message);
      return rows;
    }
    case "create_task": {
      const projectId = await projectIdByRef(ctx, input.project_reference as string | undefined);
      const { data: row, error } = await ctx.sb.from("tasks").insert({
        title: input.title, description: input.description ?? null, project_id: projectId, priority: input.priority ?? "normal",
        due_date: input.due_date ?? null, source: "ai",
      }).select("id").single();
      if (error) throw new ToolInputError(`Création refusée : ${error.message}`);
      return { task_id: row.id, status: "créée" };
    }
    case "propose_action": {
      const projectId = await projectIdByRef(ctx, input.project_reference as string | undefined);
      const { data: row, error } = await ctx.sb.from("approvals").insert({
        action_type: input.action_type, title: input.title, justification: input.justification, payload: input.payload,
        project_id: projectId, requested_by_ai: true, ai_run_id: ctx.runId,
      }).select("id").single();
      if (error) throw new ToolInputError(`Demande refusée : ${error.message}`);
      return { approval_id: row.id, status: "en attente d'approbation humaine – rien n'a été exécuté" };
    }
  }
}

async function projectIdByRef(ctx: ToolContext, ref: string | undefined) {
  if (!ref) return null;
  const d = await data(ctx);
  const p = d.projects.find((x) => x.reference.toLowerCase() === ref.toLowerCase());
  if (!p) throw new ToolInputError(`Chantier ${ref} introuvable`);
  return p.id;
}

export { isActive };
