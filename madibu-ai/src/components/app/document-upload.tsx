"use client";
import { UploadIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { createClient } from "@/lib/supabase/browser";

const MAX = 25 * 1024 * 1024;
const ALLOWED = /^(application\/pdf|image\/(jpeg|png|webp|heic)|application\/vnd\.openxmlformats-officedocument\..+|application\/msword|application\/vnd\.ms-excel|text\/csv|text\/plain)$/;

/** Téléversement direct vers Supabase Storage (bucket privé, politiques RLS par chantier). */
export function DocumentUpload({ projectId, categories, label, projects }: {
  projectId?: string; categories: Record<string, string>; label: string; projects?: Array<{ value: string; label: string }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function onSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    const file = fd.get("file") as File | null;
    const project = (fd.get("project_id") as string) || projectId || null;
    if (!file || !file.size) return toast.error("Choisissez un fichier.");
    if (file.size > MAX) return toast.error("Fichier trop volumineux (25 Mo max).");
    if (!ALLOWED.test(file.type)) return toast.error(`Type de fichier non autorisé (${file.type || "inconnu"}).`);
    setBusy(true);
    const sb = createClient();
    const safe = file.name.normalize("NFKD").replace(/[^\w.-]+/g, "_").slice(-120);
    const path = `${project ?? "general"}/${crypto.randomUUID()}-${safe}`;
    const up = await sb.storage.from("documents").upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) { setBusy(false); return toast.error(`Téléversement refusé : ${up.error.message}`); }
    const { error } = await sb.from("documents").insert({ project_id: project, name: file.name, category: fd.get("category"), storage_path: path, mime_type: file.type, size_bytes: file.size });
    setBusy(false);
    if (error) { await sb.storage.from("documents").remove([path]); return toast.error(error.message); }
    toast.success("Document ajouté");
    (ev.target as HTMLFormElement).reset();
    router.refresh();
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
      <input type="file" name="file" required className="max-w-64 text-sm" data-testid="doc-file" />
      {projects ? <NativeSelect name="project_id" className="w-56"><option value="">—</option>{projects.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</NativeSelect> : null}
      <NativeSelect name="category" className="w-44" defaultValue="other">{Object.entries(categories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect>
      <Button type="submit" size="sm" disabled={busy}><UploadIcon />{busy ? "…" : label}</Button>
    </form>
  );
}
