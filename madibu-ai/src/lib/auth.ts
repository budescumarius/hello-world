import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Role } from "./domain/types";
import { getMessages, type Locale } from "./i18n";
import { can, type Permission } from "./permissions";
import { createClient } from "./supabase/server";

export interface CurrentUser {
  id: string;
  email: string | null;
  fullName: string;
  role: Role;
  locale: Locale;
}

/** Data Access Layer : lit et vérifie la session côté serveur (jeton validé par Supabase Auth). */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("full_name, role, locale, active").eq("id", user.id).single();
  if (!profile || !profile.active) return null;
  return { id: user.id, email: user.email ?? null, fullName: profile.full_name || user.email || "", role: profile.role, locale: profile.locale };
});

export async function requireUser(): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  return u;
}

export class ForbiddenError extends Error {
  constructor(message = "Accès refusé") { super(message); }
}

/** Vérification serveur d'une permission ; à appeler dans CHAQUE Server Action / Route Handler. */
export async function requirePermission(perm: Permission): Promise<CurrentUser> {
  const u = await requireUser();
  if (!can(u.role, perm)) throw new ForbiddenError(`Permission requise : ${perm}`);
  return u;
}

export async function getT() {
  const u = await getCurrentUser();
  return { t: getMessages(u?.locale), locale: (u?.locale ?? "fr") as Locale, user: u };
}
