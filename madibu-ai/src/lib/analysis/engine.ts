import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runAllAgents, type Finding } from "../domain/analysis";
import { receivables } from "../domain/finance";
import { dailyFinancialReport, paymentReminder, weeklyProjectsReport } from "../domain/reports";
import { addDays, todayBrussels } from "../dates";
import { env } from "../env";
import { fromCents } from "../money";
import { createServiceClient } from "../supabase/server";
import { loadCompanyData } from "../data/company";

export interface AnalysisResult {
  runId: string | null;
  skipped?: boolean;
  findings: number;
  newAlerts: number;
  resolvedAlerts: number;
  tasksCreated: number;
  remindersPrepared: number;
  reports: string[];
  notified: boolean;
  aiSummary: boolean;
}

/**
 * Moteur d'automatisation : exécute tous les agents, synchronise alertes/tâches,
 * prépare les rappels (en attente d'approbation), enregistre les rapports et journalise l'exécution.
 * À appeler uniquement après vérification d'autorisation (permission `analysis.run` ou secret cron).
 * Idempotent : un passage planifié par jour (clé d'idempotence) ; rapports uniques par jour.
 */
export async function runAnalysis(opts: { trigger: "manual" | "schedule"; userId?: string; weekly?: boolean; today?: string; sb?: SupabaseClient }): Promise<AnalysisResult> {
  const sb = opts.sb ?? createServiceClient();
  const today = opts.today ?? todayBrussels();
  const idem = opts.trigger === "schedule" ? `analysis:daily:${today}` : null;

  const { data: run, error: runErr } = await sb.from("ai_runs")
    .insert({ kind: "analysis", trigger: opts.trigger, triggered_by: opts.userId ?? null, idempotency_key: idem, input_summary: `Analyse du ${today}` })
    .select("id").single();
  if (runErr) {
    if (runErr.code === "23505") return { runId: null, skipped: true, findings: 0, newAlerts: 0, resolvedAlerts: 0, tasksCreated: 0, remindersPrepared: 0, reports: [], notified: false, aiSummary: false };
    throw new Error(runErr.message);
  }

  try {
    const data = await loadCompanyData(sb);
    const findings = runAllAgents(data, today, {
      cashAlertThreshold: env.cashAlertCents(), minMarginPct: env.minMarginPct(), progressStaleDays: 14, deadlineWarningDays: 14,
    });

    const alertStats = await syncAlerts(sb, findings);
    const tasksCreated = await createTasks(sb, findings, today);
    const remindersPrepared = await prepareReminders(sb, findings, data, today, run.id, opts.userId);

    const reports: string[] = [];
    const daily = dailyFinancialReport(data, findings, today);
    let md = daily.markdown;
    let aiSummary = false;
    if (env.aiEnabled()) {
      const { executiveSummary } = await import("../ai/assistant");
      const summary = await executiveSummary(md).catch(() => null);
      if (summary) { md += `\n\n## Analyse du COO virtuel (IA)\n\n${summary}\n`; aiSummary = true; }
    }
    await upsertReport(sb, "daily_financial", today, daily.title, md, daily.data, run.id);
    reports.push("daily_financial");
    const isMonday = new Date(`${today}T12:00:00Z`).getUTCDay() === 1;
    if (opts.weekly || isMonday) {
      const weekly = weeklyProjectsReport(data, findings, today);
      await upsertReport(sb, "weekly_projects", today, weekly.title, weekly.markdown, {}, run.id);
      reports.push("weekly_projects");
    }

    const notified = await notify(sb, findings);
    const summary = `${findings.length} constats, ${alertStats.created} nouvelles alertes, ${alertStats.resolved} résolues, ${tasksCreated} tâches, ${remindersPrepared} rappels préparés`;
    await sb.from("ai_runs").update({ status: "succeeded", finished_at: new Date().toISOString(), output_summary: summary }).eq("id", run.id);
    return { runId: run.id, findings: findings.length, newAlerts: alertStats.created, resolvedAlerts: alertStats.resolved, tasksCreated, remindersPrepared, reports, notified, aiSummary };
  } catch (e) {
    await sb.from("ai_runs").update({ status: "failed", finished_at: new Date().toISOString(), error: String(e) }).eq("id", run.id);
    throw e;
  }
}

async function syncAlerts(sb: SupabaseClient, findings: Finding[]) {
  const now = new Date().toISOString();
  const { data: existing } = await sb.from("alerts").select("id, key, status");
  const byKey = new Map((existing ?? []).map((a) => [a.key, a]));
  let created = 0;
  for (const f of findings) {
    const row = {
      key: f.key, agent: f.agent, category: f.category, severity: f.severity, title: f.title, why: f.why,
      impact_amount: fromCents(f.impactAmount), recommendation: f.recommendation, responsible: f.responsible, due_date: f.dueDate,
      project_id: f.projectId, entity_table: f.entityTable, entity_id: f.entityId, last_seen_at: now,
    };
    const ex = byKey.get(f.key);
    if (!ex) {
      const { error } = await sb.from("alerts").insert({ ...row, first_seen_at: now });
      if (!error) created++;
    } else {
      // une alerte résolue qui réapparaît est rouverte ; une alerte « prise en compte » le reste
      const status = ex.status === "resolved" ? "open" : ex.status;
      if (ex.status === "resolved") created++;
      await sb.from("alerts").update({ ...row, status, resolved_at: status === "open" ? null : undefined, notified_at: ex.status === "resolved" ? null : undefined }).eq("id", ex.id);
    }
  }
  const keys = new Set(findings.map((f) => f.key));
  const stale = (existing ?? []).filter((a) => a.status !== "resolved" && !keys.has(a.key));
  for (const a of stale) {
    await sb.from("alerts").update({ status: "resolved", resolved_at: now }).eq("id", a.id);
    // les tâches automatiques liées à un problème disparu sont clôturées
    await sb.from("tasks").update({ status: "completed" }).eq("alert_key", a.key).eq("source", "ai").in("status", ["todo", "in_progress", "waiting"]);
  }
  return { created, resolved: stale.length };
}

async function createTasks(sb: SupabaseClient, findings: Finding[], today: string) {
  let n = 0;
  const since = addDays(today, -7);
  for (const f of findings.filter((x) => x.createTask)) {
    // ne pas recréer une tâche qu'un humain vient de clôturer (7 jours)
    const { data: recent } = await sb.from("tasks").select("id").eq("alert_key", f.key).in("status", ["completed", "cancelled"]).gte("updated_at", since).limit(1);
    if (recent?.length) continue;
    const { error } = await sb.from("tasks").insert({
      title: f.title.slice(0, 300), description: `${f.why}\n\n➜ ${f.recommendation}\nResponsable : ${f.responsible}`,
      project_id: f.projectId, priority: f.taskPriority, due_date: f.dueDate, source: "ai", alert_key: f.key,
    });
    if (!error) n++;
    else if (error.code !== "23505") throw new Error(error.message);
  }
  return n;
}

async function prepareReminders(sb: SupabaseClient, findings: Finding[], data: Awaited<ReturnType<typeof loadCompanyData>>, today: string, runId: string, userId?: string) {
  let n = 0;
  const rec = new Map(receivables(data, today).map((r) => [r.id, r]));
  for (const f of findings.filter((x) => x.reminder)) {
    const { invoiceId, level } = f.reminder!;
    const r = rec.get(invoiceId);
    const client = data.clients.find((c) => c.id === r?.party_id);
    if (!r || !client?.email) continue;
    const reminderKey = `reminder:${invoiceId}:L${level}`;
    const { data: exists } = await sb.from("approvals").select("id").eq("action_type", "send_email").contains("payload", { reminder_key: reminderKey }).limit(1);
    if (exists?.length) continue;
    const project = data.projects.find((p) => p.id === r.project_id);
    const { subject, body } = paymentReminder({ level, number: r.number, issueDate: r.issue_date, dueDate: r.due_date, open: r.open,
      daysOverdue: r.daysOverdue, projectName: project ? `${project.reference} ${project.name}` : null, company: env.companyName() });
    const { error } = await sb.from("approvals").insert({
      action_type: "send_email", title: `${subject} → ${client.name}`, project_id: r.project_id, requested_by_ai: true,
      requested_by: userId ?? null, ai_run_id: runId, justification: f.title,
      payload: { reminder_key: reminderKey, to: client.email, subject, body, invoice_id: invoiceId, level, open_eur: fromCents(r.open) },
    });
    if (error) throw new Error(error.message);
    n++;
  }
  return n;
}

async function upsertReport(sb: SupabaseClient, kind: string, date: string, title: string, md: string, data: Record<string, unknown>, runId: string) {
  const { error } = await sb.from("reports").upsert({ kind, report_date: date, title, content_md: md, data, ai_run_id: runId }, { onConflict: "kind,report_date" });
  if (error) throw new Error(error.message);
}

/** Notification (webhook, ex. Power Automate → Teams) des nouvelles alertes critiques/élevées, une seule fois par alerte. */
async function notify(sb: SupabaseClient, findings: Finding[]) {
  const url = env.notifyWebhook();
  const urgent = findings.filter((f) => f.severity === "critical" || f.severity === "high").map((f) => f.key);
  if (!urgent.length) return false;
  const { data: pending } = await sb.from("alerts").select("id, title, severity").in("key", urgent).is("notified_at", null).neq("status", "resolved");
  if (!pending?.length || !url) return false;
  const res = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: `${env.companyName()} : ${pending.length} alerte(s) urgente(s)`, alerts: pending.map((a) => ({ severity: a.severity, title: a.title })) }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res?.ok) return false;
  await sb.from("alerts").update({ notified_at: new Date().toISOString() }).in("id", pending.map((a) => a.id));
  return true;
}
