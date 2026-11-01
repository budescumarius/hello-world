import "server-only";
import type { z } from "zod";
import { ForbiddenError, requirePermission, type CurrentUser } from "./auth";
import type { Permission } from "./permissions";
import { createClient } from "./supabase/server";
import { flattenErrors, formToObject, type FieldErrors } from "./validation";

export interface ActionState { ok: boolean; message?: string; error?: string; fieldErrors?: FieldErrors; id?: string }
export const initialState: ActionState = { ok: false };

type Sb = Awaited<ReturnType<typeof createClient>>;

/** Erreurs PostgreSQL → messages lisibles (les messages des triggers sont déjà en français). */
export function dbError(e: { code?: string; message: string } | null | undefined): string {
  if (!e) return "Erreur inconnue";
  if (e.code === "23505") return "Cet enregistrement existe déjà (doublon).";
  if (e.code === "23503") return "Élément lié introuvable ou encore utilisé ailleurs.";
  if (e.code === "42501") return "Action non autorisée pour votre rôle.";
  if (e.code === "23514") return "Valeur refusée par une règle de contrôle.";
  return e.message;
}

/**
 * Enveloppe commune des Server Actions : permission vérifiée côté serveur, validation Zod,
 * client Supabase de l'utilisateur (RLS), gestion d'erreurs uniforme.
 */
export function makeAction<S extends z.ZodType>(perm: Permission, schema: S,
  handler: (input: z.infer<S>, ctx: { sb: Sb; user: CurrentUser; fd: FormData }) => Promise<ActionState | void>) {
  return async (_prev: ActionState, fd: FormData): Promise<ActionState> => {
    let user: CurrentUser;
    try {
      user = await requirePermission(perm);
    } catch (e) {
      if (e instanceof ForbiddenError) return { ok: false, error: "Action non autorisée pour votre rôle." };
      throw e;
    }
    const parsed = schema.safeParse(formToObject(fd));
    if (!parsed.success) return { ok: false, error: "Formulaire invalide", fieldErrors: flattenErrors(parsed.error) };
    try {
      const sb = await createClient();
      return (await handler(parsed.data, { sb, user, fd })) ?? { ok: true, message: "Enregistré" };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  };
}

/** Champs optionnels vides → null pour l'écriture en base. */
export function nullify<T extends Record<string, unknown>>(o: T): { [K in keyof T]: T[K] | null } {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === undefined ? null : v])) as never;
}
