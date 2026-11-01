"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({ email: z.email(), password: z.string().min(1).max(200) });

export async function login(_prev: { error?: string }, fd: FormData): Promise<{ error?: string }> {
  const parsed = schema.safeParse({ email: fd.get("email"), password: fd.get("password") });
  if (!parsed.success) return { error: "invalid" };
  const sb = await createClient();
  const { error } = await sb.auth.signInWithPassword(parsed.data);
  if (error) {
    await new Promise((r) => setTimeout(r, 400)); // ralentit les tentatives par force brute (GoTrue limite aussi le débit)
    return { error: "invalid" };
  }
  redirect("/dashboard");
}

export async function logout() {
  const sb = await createClient();
  await sb.auth.signOut();
  redirect("/login");
}
