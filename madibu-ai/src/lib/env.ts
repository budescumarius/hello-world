import "server-only";

/** Variables d'environnement serveur. Aucune n'est exposée au navigateur sauf les NEXT_PUBLIC_*. */
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variable d'environnement manquante : ${name}`);
  return v;
}

export const env = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  serviceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  cronSecret: () => process.env.CRON_SECRET ?? "",
  aiEnabled: () => Boolean(process.env.ANTHROPIC_API_KEY),
  claudeModel: () => process.env.CLAUDE_MODEL ?? "claude-opus-5-5",
  claudeEffort: () => (process.env.CLAUDE_EFFORT ?? "medium") as "low" | "medium" | "high" | "xhigh" | "max",
  companyName: () => process.env.MADIBU_COMPANY_NAME ?? "MADIBU GROUP",
  notifyWebhook: () => process.env.MADIBU_NOTIFY_WEBHOOK_URL ?? "",
  cashAlertCents: () => Math.round(Number(process.env.MADIBU_CASH_ALERT_EUR ?? "20000") * 100),
  minMarginPct: () => Number(process.env.MADIBU_MIN_MARGIN_PCT ?? "10"),
  aiRateLimitPer10Min: () => Number(process.env.MADIBU_AI_RATE_LIMIT ?? "20"),
};
