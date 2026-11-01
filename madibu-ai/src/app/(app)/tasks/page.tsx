import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { SeverityBadge } from "@/components/app/severity";
import { TaskDialog } from "@/components/app/task-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { formatDate, todayBrussels } from "@/lib/dates";
import { getMessages } from "@/lib/i18n";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { StatusSelect } from "./status-select";

export const metadata = { title: "Tâches" };
const PRIO_SEV = { urgent: "critical", high: "high", normal: "info", low: "info" } as const;
const OPEN = ["todo", "in_progress", "waiting"];

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ view?: string; filter?: string; project?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const t = getMessages(user.locale);
  const sb = await createClient();
  const today = todayBrussels();
  const [{ data: tasks }, { data: projects }, { data: profiles }] = await Promise.all([
    sb.from("tasks").select("*, project:projects(reference), assignee:profiles!tasks_assigned_to_fkey(full_name), creator:profiles!tasks_created_by_fkey(full_name)").order("due_date", { ascending: true, nullsFirst: false }).limit(500),
    sb.from("projects").select("id, reference, name").is("archived_at", null).order("reference"),
    sb.from("profiles").select("id, full_name").eq("active", true).order("full_name"),
  ]);
  const filter = sp.filter ?? "open";
  const list = (tasks ?? []).filter((x) =>
    (filter === "all" || (filter === "open" && OPEN.includes(x.status)) || (filter === "mine" && x.assigned_to === user.id && OPEN.includes(x.status))
      || (filter === "overdue" && OPEN.includes(x.status) && x.due_date && x.due_date < today) || (filter === "ai" && x.source === "ai" && OPEN.includes(x.status)))
    && (!sp.project || x.project_id === sp.project));
  const view = sp.view === "kanban" ? "kanban" : "list";
  const q = (o: Record<string, string | undefined>) => "/tasks?" + new URLSearchParams(Object.entries({ view, filter, project: sp.project, ...o }).filter(([, v]) => v) as [string, string][]).toString();
  const projectOpts = (projects ?? []).map((p) => ({ value: p.id, label: `${p.reference} ${p.name}` }));
  const profileOpts = (profiles ?? []).map((p) => ({ value: p.id, label: p.full_name }));
  const statusLabels = t.tasks.status as Record<string, string>;
  const card = (x: (typeof list)[number]) => {
    const overdue = OPEN.includes(x.status) && x.due_date && x.due_date < today;
    return (
      <div key={x.id} className="rounded-lg border bg-card p-3 text-sm shadow-xs">
        <div className="flex items-start justify-between gap-2"><span className="min-w-0 font-medium break-words">{x.title}</span>
          <SeverityBadge severity={PRIO_SEV[x.priority as keyof typeof PRIO_SEV]} label={t.tasks.priorities[x.priority as keyof typeof t.tasks.priorities]} /></div>
        <div className="mt-1 text-xs text-muted-foreground">{x.project ? <Link className="hover:underline" href={`/projects/${x.project_id}`}>{x.project.reference}</Link> : null}
          {x.assignee ? ` · ${x.assignee.full_name}` : ""}{x.due_date ? ` · ${formatDate(x.due_date, user.locale)}` : ""} {x.source === "ai" ? <Badge variant="outline">IA</Badge> : null}</div>
        {overdue ? <div className="mt-1"><SeverityBadge severity="warning" label={t.tasks.overdue} /></div> : null}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><StatusSelect id={x.id} value={x.status} labels={statusLabels} />
          {can(user.role, "tasks.write") ? <TaskDialog t={t} projects={projectOpts} profiles={profileOpts} task={x} /> : null}</div>
      </div>
    );
  };
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={t.tasks.title} actions={can(user.role, "tasks.write") ? <TaskDialog t={t} projects={projectOpts} profiles={profileOpts} /> : null} />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        {[["list", t.tasks.list], ["kanban", t.tasks.kanban]].map(([k, l]) => <Link key={k} href={q({ view: k })} className={cn("rounded-md border px-3 py-1.5", view === k ? "bg-primary text-primary-foreground" : "bg-card")}>{l}</Link>)}
        <span className="mx-2 h-5 w-px bg-border" />
        {[["open", "Ouvertes"], ["mine", "Mes tâches"], ["overdue", t.tasks.overdue], ["ai", "Créées par l'IA"], ["all", t.common.all]].map(([k, l]) =>
          <Link key={k} href={q({ filter: k })} className={cn("rounded-full border px-3 py-1", filter === k ? "border-primary font-medium" : "text-muted-foreground")}>{l}</Link>)}
      </div>
      {view === "kanban" ? (
        <div className="grid auto-cols-[minmax(240px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2" data-testid="kanban">
          {["todo", "in_progress", "waiting", "completed", "cancelled"].map((s) => { const col = (filter === "open" ? (tasks ?? []).filter((x) => !sp.project || x.project_id === sp.project) : list).filter((x) => x.status === s); return (
            <div key={s} className="min-w-0 rounded-xl bg-muted/60 p-2"><div className="mb-2 px-1 text-xs font-semibold text-muted-foreground">{statusLabels[s]} ({col.length})</div>
              <div className="grid gap-2">{col.slice(0, 50).map(card)}</div></div>); })}
        </div>
      ) : (
        <Card><CardContent className="overflow-x-auto">{!list.length ? <p className="text-sm text-muted-foreground">{t.common.none}</p> : (
          <table className="w-full text-sm" data-testid="tasks-table"><thead><tr className="border-b text-xs text-muted-foreground">
            <th className="py-2 text-left">{t.common.name}</th><th className="text-left">{t.common.project}</th><th className="text-left">{t.tasks.assignee}</th>
            <th className="text-left">{t.tasks.priority}</th><th className="text-left">{t.tasks.due}</th><th className="text-left">{t.tasks.source}</th><th className="text-left">{t.common.status}</th><th /></tr></thead>
            <tbody>{list.map((x) => (
              <tr key={x.id} className="border-b last:border-0"><td className="py-2">{x.title}{x.description ? <div className="max-w-md truncate text-xs text-muted-foreground">{x.description}</div> : null}</td>
                <td>{x.project ? <Link className="hover:underline" href={`/projects/${x.project_id}`}>{x.project.reference}</Link> : "—"}</td><td>{x.assignee?.full_name ?? "—"}</td>
                <td><SeverityBadge severity={PRIO_SEV[x.priority as keyof typeof PRIO_SEV]} label={t.tasks.priorities[x.priority as keyof typeof t.tasks.priorities]} /></td>
                <td className={cn(OPEN.includes(x.status) && x.due_date && x.due_date < today && "font-semibold text-critical")}>{formatDate(x.due_date, user.locale)}</td>
                <td>{t.tasks.sources[x.source as keyof typeof t.tasks.sources]}{x.creator ? <span className="text-xs text-muted-foreground"> · {x.creator.full_name}</span> : null}</td>
                <td><StatusSelect id={x.id} value={x.status} labels={statusLabels} /></td>
                <td>{can(user.role, "tasks.write") ? <TaskDialog t={t} projects={projectOpts} profiles={profileOpts} task={x} /> : null}</td></tr>))}</tbody></table>)}
        </CardContent></Card>
      )}
    </div>
  );
}
