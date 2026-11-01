/**
 * Intégration de l'assistant IA avec la base réelle (Supabase local) :
 * - les outils s'exécutent avec la session de l'utilisateur (RLS) ;
 * - une action sensible ne fait que déposer une demande « pending » ;
 * - la boucle d'outils gère tool_use → tool_result → réponse finale.
 * Le modèle Claude est simulé (aucune clé API requise, aucun coût).
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: ".env.local" });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const d = url && anon && service ? describe : describe.skip;

async function userClient(admin: SupabaseClient, role: string) {
  const email = `${role}-${randomUUID().slice(0, 8)}@test.local`, password = `Test-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  await admin.from("profiles").update({ role }).eq("id", data.user.id);
  const sb = createClient(url!, anon!, { auth: { persistSession: false } });
  const { error: e2 } = await sb.auth.signInWithPassword({ email, password });
  if (e2) throw e2;
  return { sb, id: data.user.id };
}

d("Assistant IA – outils et boucle (base réelle, modèle simulé)", () => {
  let admin: SupabaseClient;
  const created: string[] = [];
  let projectRef = "";
  beforeAll(async () => {
    admin = createClient(url!, service!, { auth: { persistSession: false } });
    projectRef = `T-AI-${randomUUID().slice(0, 6)}`;
    const { data: c } = await admin.from("clients").insert({ name: `Client IA ${projectRef}`, email: "ia@test.local" }).select("id").single();
    const { data: p } = await admin.from("projects").insert({ reference: projectRef, name: "Test IA", client_id: c!.id, status: "in_progress", contract_amount_excl: 50000 }).select("id").single();
    await admin.from("invoices").insert({ direction: "issued", number: `F-${projectRef}`, project_id: p!.id, client_id: c!.id, issue_date: "2026-08-01",
      due_date: "2026-08-31", amount_excl: 10000, vat_rate: 6, vat_amount: 600, status: "issued" });
  });
  afterAll(async () => { for (const id of created) await admin.auth.admin.deleteUser(id).catch(() => {}); });

  it("un utilisateur finance voit les créances via l'outil (montants convertis en euros)", async () => {
    const { executeTool, centsToEur } = await import("@/lib/ai/tools");
    const { sb, id } = await userClient(admin, "finance"); created.push(id);
    const out = centsToEur(await executeTool({ sb, userId: id, today: "2026-11-01", runId: null }, "list_receivables", { overdue_only: true })) as Array<Record<string, unknown>>;
    const row = out.find((r) => r.number === `F-${projectRef}`)!;
    expect(row.open).toBe(10600);       // euros TVAC, pas des centimes
    expect(row.daysOverdue).toBe(62);   // non converti
  });

  it("un chef de chantier non assigné ne voit aucune créance (RLS appliquée à l'IA)", async () => {
    const { executeTool } = await import("@/lib/ai/tools");
    const { sb, id } = await userClient(admin, "site_manager"); created.push(id);
    const out = await executeTool({ sb, userId: id, today: "2026-11-01", runId: null }, "list_receivables", {}) as unknown[];
    expect(out).toEqual([]);
    await expect(executeTool({ sb, userId: id, today: "2026-11-01", runId: null }, "get_project", { reference: projectRef })).rejects.toThrow(/introuvable/);
  });

  it("propose_action dépose une demande en attente, jamais exécutée", async () => {
    const { executeTool } = await import("@/lib/ai/tools");
    const { sb, id } = await userClient(admin, "admin"); created.push(id);
    const r = await executeTool({ sb, userId: id, today: "2026-11-01", runId: null }, "propose_action", {
      action_type: "make_payment", title: "Payer un fournisseur", justification: "Facture échue", payload: { amount_eur: 100 }, project_reference: projectRef,
    }) as { approval_id: string };
    const { data } = await admin.from("approvals").select("status, requested_by_ai, requested_by, decided_by").eq("id", r.approval_id).single();
    expect(data).toEqual({ status: "pending", requested_by_ai: true, requested_by: id, decided_by: null });
  });

  it("rejette des paramètres invalides (validation Zod)", async () => {
    const { executeTool } = await import("@/lib/ai/tools");
    const { sb, id } = await userClient(admin, "admin"); created.push(id);
    await expect(executeTool({ sb, userId: id, today: "2026-11-01", runId: null }, "create_task", { title: "x", hack: true })).rejects.toThrow(/Paramètres invalides/);
    await expect(executeTool({ sb, userId: id, today: "2026-11-01", runId: null }, "drop_table", {})).rejects.toThrow(/Outil inconnu/);
  });

  it("boucle complète : appel d'outil puis réponse, exécution journalisée dans ai_runs", async () => {
    const { chat } = await import("@/lib/ai/assistant");
    const { sb, id } = await userClient(admin, "finance"); created.push(id);
    const calls: unknown[] = [];
    const responses = [
      { stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "tool_use", id: "tu_1", name: "get_company_overview", input: {} }] },
      { stop_reason: "end_turn", usage: { input_tokens: 20, output_tokens: 8 }, content: [{ type: "text", text: "FAIT : synthèse lue." }] },
    ];
    const fake = { beta: { messages: { create: async (p: unknown) => { calls.push(p); return responses.shift(); } } } };
    const res = await chat(sb, id, [{ role: "user", content: "Situation ?" }], { anthropic: fake as never });
    expect(res.reply).toBe("FAIT : synthèse lue.");
    const second = calls[1] as { messages: Array<{ role: string; content: unknown }> };
    const toolResult = (second.messages.at(-1)!.content as Array<{ type: string; content: string }>)[0];
    expect(toolResult.type).toBe("tool_result");
    expect(JSON.parse(toolResult.content)).toHaveProperty("receivablesOpen");
    const first = calls[0] as { model: string; fallbacks: string; betas: string[] };
    expect(first.model).toBe("claude-opus-5-5");
    expect(first.fallbacks).toBe("default");
    const { data: run } = await admin.from("ai_runs").select("status, input_tokens, output_tokens, tool_calls").eq("id", res.runId!).single();
    expect(run).toMatchObject({ status: "succeeded", input_tokens: 30, output_tokens: 13, tool_calls: [{ name: "get_company_overview", ok: true }] });
  });
});
