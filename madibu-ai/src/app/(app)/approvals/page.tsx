import Link from "next/link";
import { ActionButton } from "@/components/app/action-button";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth";
import { getMessages } from "@/lib/i18n";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { decideApproval, recordExecution } from "../_actions";
import { CopyButton } from "./copy-button";

export const metadata = { title: "Approbations" };

export default async function ApprovalsPage() {
  const user = await requirePermission("approvals.view");
  const t = getMessages(user.locale);
  const sb = await createClient();
  const { data: rows } = await sb.from("approvals")
    .select("*, project:projects(reference), requester:profiles!approvals_requested_by_fkey(full_name), decider:profiles!approvals_decided_by_fkey(full_name), executor:profiles!approvals_executed_by_fkey(full_name)")
    .order("created_at", { ascending: false }).limit(200);
  const decide = can(user.role, "approvals.decide");
  const pending = (rows ?? []).filter((r) => r.status === "pending");
  const approved = (rows ?? []).filter((r) => r.status === "approved");
  const history = (rows ?? []).filter((r) => !["pending", "approved"].includes(r.status));
  const fmt = (d: string | null) => (d ? new Date(d).toLocaleString(user.locale === "ro" ? "ro-RO" : "fr-BE", { timeZone: "Europe/Brussels" }) : "—");
  const actions = t.approvals.actions as Record<string, string>;
  const status = t.approvals.status as Record<string, string>;

  const item = (r: NonNullable<typeof rows>[number]) => {
    const p = (r.payload ?? {}) as Record<string, unknown>;
    return (
      <li key={r.id} className="grid gap-2 py-3" data-testid="approval">
        <div className="flex flex-wrap items-center gap-2"><Badge>{actions[r.action_type]}</Badge><span className="font-medium">{r.title}</span>
          <Badge variant="outline">{status[r.status]}</Badge>{r.project ? <Link className="text-xs hover:underline" href={`/projects/${r.project_id}`}>{r.project.reference}</Link> : null}</div>
        <div className="text-xs text-muted-foreground">{t.approvals.requestedBy} : {r.requested_by_ai ? `${t.approvals.ai}${r.requester ? ` (session de ${r.requester.full_name})` : " (analyse automatique)"}` : r.requester?.full_name ?? "—"} · {fmt(r.created_at)}
          {r.decider ? ` · ${t.approvals.decidedBy} : ${r.decider.full_name} (${fmt(r.decided_at)})` : ""}{r.executor ? ` · exécutée par ${r.executor.full_name} (${fmt(r.executed_at)})` : ""}</div>
        {r.justification ? <div className="text-sm">{r.justification}</div> : null}
        {r.action_type === "send_email" && typeof p.body === "string" ? (
          <details className="rounded-md border bg-muted/40 p-2 text-sm"><summary className="cursor-pointer">✉ {String(p.subject ?? "")} → {String(p.to ?? "")}</summary>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-xs">{p.body}</pre><CopyButton text={`${p.subject}\n\n${p.body}`} /></details>
        ) : Object.keys(p).length ? <pre className="overflow-x-auto rounded-md bg-muted/40 p-2 text-xs">{JSON.stringify(p, null, 2)}</pre> : null}
        {r.decision_note ? <div className="text-xs">{t.approvals.note} : {r.decision_note}</div> : null}
        {r.execution_result ? <div className="text-xs">{t.approvals.result} : {r.execution_result}</div> : null}
        {decide && r.status === "pending" ? <div className="flex gap-2">
          <ActionButton variant="default" testId={`approve-${r.id}`} action={decideApproval.bind(null, r.id, true)} prompt={`${t.approvals.note} (facultatif)`}>{t.approvals.approve}</ActionButton>
          <ActionButton variant="destructive" action={decideApproval.bind(null, r.id, false)} prompt="Motif du refus">{t.approvals.reject}</ActionButton></div> : null}
        {decide && r.status === "approved" ? <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">{t.approvals.noIntegration}</span>
          <ActionButton testId={`executed-${r.id}`} action={recordExecution.bind(null, r.id, true)} prompt="Résultat (ex. « envoyé depuis Outlook le … »)">{t.approvals.markExecuted}</ActionButton>
          <ActionButton variant="ghost" action={recordExecution.bind(null, r.id, false)} prompt="Motif de l'échec">{t.approvals.markFailed}</ActionButton></div> : null}
      </li>
    );
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t.approvals.title} description="Toute action externe ou à fort impact préparée par l'IA attend ici une décision humaine. Une demande de l'IA ne peut jamais s'approuver elle-même (contrôle en base de données)." />
      <div className="grid gap-4">
        <Card><CardHeader><CardTitle>{t.approvals.pending} ({pending.length})</CardTitle></CardHeader><CardContent>{pending.length ? <ul className="divide-y">{pending.map(item)}</ul> : <p className="text-sm text-muted-foreground">{t.common.none}</p>}</CardContent></Card>
        {approved.length ? <Card><CardHeader><CardTitle>{status.approved} – à exécuter ({approved.length})</CardTitle></CardHeader><CardContent><ul className="divide-y">{approved.map(item)}</ul></CardContent></Card> : null}
        <Card><CardHeader><CardTitle>{t.approvals.history}</CardTitle></CardHeader><CardContent>{history.length ? <ul className="divide-y">{history.map(item)}</ul> : <p className="text-sm text-muted-foreground">{t.common.none}</p>}</CardContent></Card>
      </div>
    </div>
  );
}
