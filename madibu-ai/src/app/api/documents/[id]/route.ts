import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** Téléchargement : URL signée de 60 s, générée avec la session de l'utilisateur (RLS sur la table et le stockage). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "Identifiant invalide" }, { status: 400 });
  const sb = await createClient();
  const { data: doc } = await sb.from("documents").select("storage_path, name").eq("id", id).maybeSingle();
  if (!doc) return NextResponse.json({ error: "Document introuvable" }, { status: 404 });
  const { data, error } = await sb.storage.from("documents").createSignedUrl(doc.storage_path, 60, { download: doc.name });
  if (error || !data) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  return NextResponse.redirect(data.signedUrl);
}
