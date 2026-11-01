import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { env } from "../env";

/**
 * Client Supabase lié à la session de l'utilisateur (cookies) : TOUTES les requêtes
 * passent par la RLS PostgreSQL avec l'identité de l'utilisateur.
 * `actor: "ai"` ajoute l'en-tête lu par le trigger d'audit pour marquer les actions de l'IA.
 */
export async function createClient(opts: { actor?: "ai" } = {}) {
  const cookieStore = await cookies();
  return createServerClient(env.supabaseUrl(), env.supabaseAnonKey(), {
    global: opts.actor === "ai" ? { headers: { "x-madibu-actor": "ai" } } : undefined,
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // appelé depuis un Server Component : le proxy se charge du rafraîchissement
        }
      },
    },
  });
}

/**
 * Client « service » (contourne la RLS). Réservé aux tâches système déclenchées côté serveur
 * APRÈS vérification d'autorisation (analyse planifiée, cron). Jamais exposé au navigateur.
 */
export function createServiceClient() {
  return createPlainClient(env.supabaseUrl(), env.serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-madibu-actor": "system" } },
  });
}
