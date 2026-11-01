"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Messages } from "@/lib/i18n";
import { login } from "./actions";

export function LoginForm({ t }: { t: Messages["auth"] }) {
  const [state, action, pending] = useActionState(login, {});
  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-1.5"><Label htmlFor="email">{t.email}</Label><Input id="email" name="email" type="email" autoComplete="username" required /></div>
      <div className="grid gap-1.5"><Label htmlFor="password">{t.password}</Label><Input id="password" name="password" type="password" autoComplete="current-password" required /></div>
      {state.error ? <p role="alert" className="text-sm text-critical">{t.invalid}</p> : null}
      <Button type="submit" disabled={pending}>{pending ? "…" : t.submit}</Button>
      <p className="text-xs text-muted-foreground">{t.noAccount}</p>
    </form>
  );
}
