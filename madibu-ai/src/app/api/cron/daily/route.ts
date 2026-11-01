import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runAnalysis } from "@/lib/analysis/engine";
import { env } from "@/lib/env";

/**
 * Exécution planifiée (ex. Vercel Cron, Supabase pg_cron + pg_net, Power Automate, cron système).
 * Protégée par CRON_SECRET ; idempotente (une exécution planifiée par jour).
 */
export async function GET(req: Request) {
  const secret = env.cronSecret();
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const ok = secret.length >= 16 && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  try {
    const result = await runAnalysis({ trigger: "schedule" });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
