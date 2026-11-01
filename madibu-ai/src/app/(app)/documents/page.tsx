import Link from "next/link";
import { ActionButton } from "@/components/app/action-button";
import { DocumentUpload } from "@/components/app/document-upload";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { getMessages } from "@/lib/i18n";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { deleteDocument } from "../_actions";

export const metadata = { title: "Documents" };

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ category?: string; project?: string }> }) {
  const sp = await searchParams;
  const user = await requirePermission("documents.view");
  const t = getMessages(user.locale);
  const sb = await createClient();
  let q = sb.from("documents").select("id, name, category, size_bytes, created_at, project_id, project:projects(reference), uploader:profiles!documents_uploaded_by_fkey(full_name)").order("created_at", { ascending: false }).limit(300);
  if (sp.category) q = q.eq("category", sp.category);
  if (sp.project) q = q.eq("project_id", sp.project);
  const [{ data: docs }, { data: projects }] = await Promise.all([q, sb.from("projects").select("id, reference, name").is("archived_at", null).order("reference")]);
  const cats = t.documents.categories as Record<string, string>;
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={t.documents.title} description="Stockage privé (Supabase Storage) ; accès limité par chantier ; liens de téléchargement valables 60 secondes." />
      {can(user.role, "documents.write") ? <Card className="mb-4"><CardContent>
        <DocumentUpload categories={cats} label={t.documents.upload} projects={(projects ?? []).map((p) => ({ value: p.id, label: `${p.reference} ${p.name}` }))} />
      </CardContent></Card> : null}
      <form className="mb-3 flex flex-wrap gap-2 text-sm">
        <select name="project" defaultValue={sp.project ?? ""} className="h-9 rounded-md border bg-card px-2"><option value="">{t.common.project} : {t.common.all}</option>
          {(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.reference}</option>)}</select>
        <select name="category" defaultValue={sp.category ?? ""} className="h-9 rounded-md border bg-card px-2"><option value="">{t.documents.category} : {t.common.all}</option>
          {Object.entries(cats).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button className="h-9 rounded-md border bg-card px-3">OK</button>
      </form>
      <Card><CardContent className="overflow-x-auto">{!docs?.length ? <p className="text-sm text-muted-foreground">{t.common.none}</p> : (
        <table className="w-full text-sm" data-testid="documents-table"><thead><tr className="border-b text-xs text-muted-foreground"><th className="py-2 text-left">{t.common.name}</th><th className="text-left">{t.common.project}</th>
          <th className="text-left">{t.documents.category}</th><th className="text-right">{t.documents.size}</th><th className="pl-3 text-left">{t.documents.uploadedBy}</th><th /></tr></thead>
          <tbody>{docs.map((d) => {
            const project = d.project as unknown as { reference: string } | null;
            const uploader = d.uploader as unknown as { full_name: string } | null;
            return (<tr key={d.id} className="border-b last:border-0"><td className="py-2"><a className="hover:underline" href={`/api/documents/${d.id}`}>{d.name}</a></td>
              <td>{project ? <Link className="hover:underline" href={`/projects/${d.project_id}?tab=documents`}>{project.reference}</Link> : t.documents.general}</td>
              <td>{cats[d.category]}</td><td className="text-right tabular">{Math.ceil((d.size_bytes ?? 0) / 1024)} Ko</td>
              <td className="pl-3">{uploader?.full_name ?? "—"} · {formatDate(d.created_at, user.locale)}</td>
              <td className="text-right">{can(user.role, "audit.view") ? <ActionButton variant="ghost" action={deleteDocument.bind(null, d.id)} confirm="Supprimer définitivement ce document ?">✕</ActionButton> : null}</td></tr>);
          })}</tbody></table>)}
      </CardContent></Card>
    </div>
  );
}
