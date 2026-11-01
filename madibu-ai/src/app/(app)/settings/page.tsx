import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { RunAnalysisButton } from "@/components/app/run-analysis-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { env } from "@/lib/env";
import { getMessages } from "@/lib/i18n";
import { AI_AUTONOMOUS, AI_REQUIRES_APPROVAL, can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { LocaleSwitch } from "../locale-switch";
import { ImportPanel } from "./import-panel";
import { NewUserDialog, RoleSelect } from "./user-admin";

export const metadata = { title: "Paramètres" };
const AUTONOMOUS_FR: Record<string, string> = { read_data: "Lire les données autorisées", analyse: "Analyser l'activité", calculate_indicators: "Calculer les indicateurs",
  generate_reports: "Générer les rapports", create_internal_tasks: "Créer des tâches internes", detect_risks: "Détecter les risques", prepare_proposals: "Préparer des propositions (brouillons, rappels, bons de commande)" };

export default async function SettingsPage() {
  const user = await requireUser();
  const t = getMessages(user.locale);
  const sb = await createClient();
  const isOwner = can(user.role, "settings.users");
  const [{ data: profiles }, { data: runs }, { data: logs }, { data: reports }] = await Promise.all([
    isOwner ? sb.from("profiles").select("id, full_name, email, role, active").order("full_name") : Promise.resolve({ data: null }),
    can(user.role, "audit.view") ? sb.from("ai_runs").select("id, kind, trigger, status, started_at, output_summary, error").order("started_at", { ascending: false }).limit(15) : Promise.resolve({ data: null }),
    can(user.role, "audit.view") ? sb.from("audit_logs").select("id, created_at, actor_type, action, table_name, actor_id").order("created_at", { ascending: false }).limit(60) : Promise.resolve({ data: null }),
    sb.from("reports").select("id, kind, report_date").order("report_date", { ascending: false }).limit(10),
  ]);
  const roles = t.roles as Record<string, string>;
  const actions = t.approvals.actions as Record<string, string>;
  const fmt = (d: string) => new Date(d).toLocaleString(user.locale === "ro" ? "ro-RO" : "fr-BE", { timeZone: "Europe/Brussels" });
  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <PageHeader title={t.settings.title} />
      <Card><CardHeader><CardTitle>{t.settings.language}</CardTitle></CardHeader><CardContent className="text-sm"><div className="inline-block rounded-md bg-sidebar p-2"><LocaleSwitch locale={user.locale} /></div>
        <p className="mt-2 text-muted-foreground">Fuseau horaire : Europe/Brussels · Devise : EUR · Calculs de rentabilité HTVA, TVA stockée séparément.</p></CardContent></Card>

      {isOwner ? <Card><CardHeader><CardTitle>{t.settings.users}</CardTitle><NewUserDialog roles={roles} label={t.settings.invite} /></CardHeader><CardContent className="overflow-x-auto">
        <table className="w-full text-sm"><thead><tr className="border-b text-xs text-muted-foreground"><th className="py-2 text-left">{t.common.name}</th><th className="text-left">{t.common.email}</th><th className="text-left">{t.settings.role}</th></tr></thead>
          <tbody>{(profiles ?? []).map((p) => <tr key={p.id} className="border-b last:border-0"><td className="py-2">{p.full_name}{!p.active ? <Badge variant="outline" className="ml-1">inactif</Badge> : null}</td><td>{p.email}</td>
            <td><RoleSelect id={p.id} role={p.role} active={p.active} roles={roles} self={p.id === user.id} /></td></tr>)}</tbody></table>
      </CardContent></Card> : null}

      {can(user.role, "import.run") ? <Card><CardHeader><CardTitle>{t.settings.import}</CardTitle></CardHeader><CardContent>
        <ImportPanel labels={{ preview: t.settings.preview, commit: t.settings.commit, help: t.settings.importHelp, valid: t.settings.rowsValid, invalid: t.settings.rowsInvalid }} />
      </CardContent></Card> : null}

      <Card><CardHeader><CardTitle>{t.settings.automation}</CardTitle>{can(user.role, "analysis.run") ? <div className="flex gap-2"><RunAnalysisButton label={t.dashboard.runAnalysis} /><RunAnalysisButton weekly label={t.reports.weekly} /></div> : null}</CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <ul className="list-disc pl-5 text-muted-foreground">
            <li>Analyse quotidienne planifiée : <code>GET /api/cron/daily</code> avec l&apos;en-tête <code>Authorization: Bearer CRON_SECRET</code> ({env.cronSecret() ? "secret configuré" : "⚠ CRON_SECRET non défini"}). Une seule exécution planifiée par jour (clé d&apos;idempotence).</li>
            <li>Notifications des nouvelles alertes critiques : {env.notifyWebhook() ? "webhook configuré" : "aucun webhook (MADIBU_NOTIFY_WEBHOOK_URL) – alertes visibles dans le tableau de bord uniquement"}.</li>
            <li>Assistant et synthèse IA : {env.aiEnabled() ? `activés (${env.claudeModel()})` : "désactivés (ANTHROPIC_API_KEY absente)"}.</li>
          </ul>
          <div><strong>{t.reports.title}</strong> : {(reports ?? []).map((r) => <Link key={r.id} className="mr-3 underline" href={`/financial/reports/${r.id}`}>{formatDate(r.report_date, user.locale)} ({r.kind === "daily_financial" ? "financier" : "chantiers"})</Link>)}{!reports?.length ? t.reports.empty : null}</div>
          {runs ? <table className="w-full text-xs"><thead><tr className="border-b text-muted-foreground"><th className="py-1 text-left">Début</th><th className="text-left">Type</th><th className="text-left">Déclencheur</th><th className="text-left">Statut</th><th className="text-left">Résumé</th></tr></thead>
            <tbody>{runs.map((r) => <tr key={r.id} className="border-b"><td className="py-1">{fmt(r.started_at)}</td><td>{r.kind}</td><td>{r.trigger}</td><td>{r.status}</td><td className="max-w-md truncate">{r.output_summary ?? r.error ?? ""}</td></tr>)}</tbody></table> : null}
        </CardContent></Card>

      <Card><CardHeader><CardTitle>Permissions de l&apos;IA</CardTitle></CardHeader><CardContent className="grid gap-4 text-sm md:grid-cols-2">
        <div><h3 className="mb-1 font-medium">Actions autonomes</h3><ul className="list-disc pl-5">{AI_AUTONOMOUS.map((a) => <li key={a}>{AUTONOMOUS_FR[a]}</li>)}</ul></div>
        <div><h3 className="mb-1 font-medium">Approbation humaine obligatoire</h3><ul className="list-disc pl-5">{AI_REQUIRES_APPROVAL.map((a) => <li key={a}>{actions[a]}</li>)}</ul></div>
      </CardContent></Card>

      {logs ? <Card><CardHeader><CardTitle>{t.settings.audit}</CardTitle><span className="text-xs text-muted-foreground">en ajout seul · 60 dernières entrées</span></CardHeader><CardContent className="overflow-x-auto">
        <table className="w-full text-xs" data-testid="audit"><thead><tr className="border-b text-muted-foreground"><th className="py-1 text-left">Date</th><th className="text-left">Acteur</th><th className="text-left">Action</th><th className="text-left">Table</th></tr></thead>
          <tbody>{logs.map((l) => <tr key={l.id} className="border-b"><td className="py-1">{fmt(l.created_at)}</td><td>{l.actor_type}{l.actor_id ? ` · ${l.actor_id.slice(0, 8)}` : ""}</td><td>{l.action}</td><td>{l.table_name}</td></tr>)}</tbody></table>
      </CardContent></Card> : null}
    </div>
  );
}
