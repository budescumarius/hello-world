import { NextResponse } from "next/server";
import { z } from "zod";
import { chat } from "@/lib/ai/assistant";
import { getCurrentUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

const body = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(8000) })).min(1).max(30),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
  if (!can(user.role, "assistant.use")) return NextResponse.json({ error: "Accès à l'assistant non autorisé pour votre rôle" }, { status: 403 });
  if (!env.aiEnabled()) return NextResponse.json({ error: "Assistant IA non configuré (ANTHROPIC_API_KEY)" }, { status: 503 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || parsed.data.messages.at(-1)?.role !== "user") return NextResponse.json({ error: "Requête invalide" }, { status: 400 });

  // Limitation de débit persistante (fonctionne aussi en serverless) : N requêtes / 10 min / utilisateur
  const sb = await createClient({ actor: "ai" });
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const { count } = await sb.from("ai_runs").select("id", { count: "exact", head: true }).eq("triggered_by", user.id).eq("kind", "chat").gte("started_at", since);
  if ((count ?? 0) >= env.aiRateLimitPer10Min()) return NextResponse.json({ error: "Trop de requêtes : réessayez dans quelques minutes." }, { status: 429 });

  const result = await chat(sb, user.id, parsed.data.messages);
  return NextResponse.json(result, { status: result.error ? 502 : 200 });
}
