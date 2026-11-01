"use client";
import { createBrowserClient } from "@supabase/ssr";

/** Client navigateur : clé publique (anon) uniquement, protégée par la RLS. */
export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
