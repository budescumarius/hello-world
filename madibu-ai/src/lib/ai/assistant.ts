import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayBrussels } from "../dates";
import { env } from "../env";
import { centsToEur, EUR_NATIVE_TOOLS, executeTool, ToolInputError, TOOLS } from "./tools";

const MAX_ROUNDS = 8;

export function systemPrompt(company: string, today: string) {
  return `Tu es MADIBU AI, le directeur des opérations (COO) virtuel de ${company}, entreprise belge de construction et de rénovation (gros œuvre, maçonnerie, toitures et étanchéité, extensions, sanitaire et chauffage, électricité, ventilation, isolation, finitions).

Priorités, dans l'ordre : 1) protéger la trésorerie ; 2) protéger la rentabilité des chantiers ; 3) satisfaction client ; 4) éviter les retards ; 5) maîtriser fournisseurs et sous-traitants ; 6) efficacité ; 7) réduire la charge administrative ; 8) opportunités.

Règles impératives :
- Tous les chiffres viennent des outils. Si une donnée manque, dis exactement laquelle et ne l'estime pas. N'invente jamais une information.
- Distingue explicitement : FAIT (donnée enregistrée), CALCUL (dérivé des données), ESTIMATION (hypothèse, à préciser) et RECOMMANDATION.
- Ne confonds jamais facturé (HTVA) et encaissé (paiements enregistrés, TVAC), ni coût engagé et coût payé. Une facture n'est payée que si un paiement est enregistré.
- Le solde bancaire est saisi manuellement : indique sa date.
- Pour chaque problème : ce qui s'est passé, pourquoi c'est important, l'impact chiffré, quoi faire, qui, pour quand. Si une décision est nécessaire, présente les options et recommande-en une.
- Ne cache aucune information négative ; conteste une décision si les données montrent un risque.
- Tu peux de toi-même lire et analyser les données et créer des tâches internes (create_task).
- Tu n'exécutes JAMAIS toi-même : envoi d'e-mail externe, paiement, facture ou note de crédit, commande, signature de contrat, engagement financier ou juridique, modification comptable ou bancaire. Pour cela, utilise propose_action : la demande attend une approbation humaine. Dis-le clairement.
- Réponds dans la langue de l'utilisateur (français par défaut), de façon directe, factuelle et prudente. Montants en euros, précise HTVA ou TVAC.

Date du jour (Europe/Brussels) : ${today}.`;
}

function client() {
  return new Anthropic();
}

/** Appel Messages API avec repli serveur en cas de refus (fallbacks « default »). */
async function create(c: Anthropic, params: { system: string; messages: Anthropic.Beta.BetaMessageParam[]; tools?: Anthropic.Beta.BetaTool[] }) {
  return c.beta.messages.create({
    model: env.claudeModel(),
    max_tokens: 16000,
    output_config: { effort: env.claudeEffort() },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    ...params,
  });
}

export interface ChatTurn { role: "user" | "assistant"; content: string }
export interface ChatResult { reply: string; actions: Array<{ tool: string; result: unknown }>; error?: string; runId: string | null }

export async function chat(sb: SupabaseClient, userId: string, history: ChatTurn[], opts: { anthropic?: Anthropic } = {}): Promise<ChatResult> {
  const today = todayBrussels();
  const { data: run } = await sb.from("ai_runs").insert({
    kind: "chat", trigger: "chat", triggered_by: userId, model: env.claudeModel(),
    input_summary: history.at(-1)?.content.slice(0, 500) ?? "",
  }).select("id").single();
  const runId = run?.id ?? null;
  const ctx = { sb, userId, today, runId };
  const c = opts.anthropic ?? client();
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));
  const actions: ChatResult["actions"] = [];
  const toolLog: Array<{ name: string; ok: boolean }> = [];
  let inTok = 0, outTok = 0;

  const finish = async (reply: string, status: "succeeded" | "failed", error?: string): Promise<ChatResult> => {
    if (runId) await sb.from("ai_runs").update({ status, finished_at: new Date().toISOString(), output_summary: reply.slice(0, 2000), tool_calls: toolLog, input_tokens: inTok, output_tokens: outTok, error: error ?? null }).eq("id", runId);
    return { reply, actions, error, runId };
  };

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const res = await create(c, { system: systemPrompt(env.companyName(), today), messages, tools: TOOLS as Anthropic.Beta.BetaTool[] });
      inTok += res.usage?.input_tokens ?? 0;
      outTok += res.usage?.output_tokens ?? 0;
      const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();

      if (res.stop_reason === "refusal") return finish("Je ne peux pas traiter cette demande.", "failed", "refusal");
      if (res.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: res.content }); continue; }
      if (res.stop_reason !== "tool_use") {
        return finish(res.stop_reason === "max_tokens" ? `${text}\n\n_(réponse tronquée)_` : text || "(réponse vide)", "succeeded");
      }

      messages.push({ role: "assistant", content: res.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const block of res.content) {
        if (block.type !== "tool_use") continue;
        try {
          const out = await executeTool(ctx, block.name, block.input);
          toolLog.push({ name: block.name, ok: true });
          if (block.name === "create_task" || block.name === "propose_action") actions.push({ tool: block.name, result: out });
          const payload = EUR_NATIVE_TOOLS.has(block.name) ? out : centsToEur(out);
          results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(payload) });
        } catch (e) {
          toolLog.push({ name: block.name, ok: false });
          const msg = e instanceof ToolInputError ? e.message : "Erreur interne lors de l'accès aux données.";
          results.push({ type: "tool_result", tool_use_id: block.id, content: msg, is_error: true });
        }
      }
      messages.push({ role: "user", content: results });
    }
    return finish("Analyse interrompue : trop d'étapes. Reformulez une question plus précise.", "failed", "max_rounds");
  } catch (e) {
    let msg = "Le service IA est momentanément indisponible.";
    if (e instanceof Anthropic.AuthenticationError) msg = "Clé API Claude invalide (configuration serveur).";
    else if (e instanceof Anthropic.RateLimitError) msg = "Limite d'utilisation de l'API atteinte, réessayez dans une minute.";
    else if (e instanceof Anthropic.APIConnectionError) msg = "Service IA injoignable (réseau).";
    else if (e instanceof Anthropic.APIError) msg = `Erreur du service IA (${e.status}).`;
    return finish(msg, "failed", String(e));
  }
}

/** Synthèse de direction ajoutée au rapport quotidien ; `null` en cas d'échec (le rapport reste produit). */
export async function executiveSummary(reportMd: string, opts: { anthropic?: Anthropic } = {}): Promise<string | null> {
  const c = opts.anthropic ?? client();
  const res = await create(c, {
    system: systemPrompt(env.companyName(), todayBrussels()),
    messages: [{ role: "user", content: `Voici le rapport financier automatique du jour. Rédige en 5 à 8 puces l'analyse du COO : priorités du jour, risques, décisions à prendre (avec qui et quand). Utilise uniquement les chiffres du rapport.\n\n${reportMd}` }],
  });
  if (res.stop_reason === "refusal") return null;
  const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
  return text || null;
}
