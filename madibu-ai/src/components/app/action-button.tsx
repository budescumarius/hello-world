"use client";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/lib/actions";

/** Bouton déclenchant une Server Action simple, avec confirmation et retour visuel. */
export function ActionButton({ action, children, confirm, prompt, variant = "outline", size = "sm", testId }: {
  action: (input?: string) => Promise<ActionState>; children: React.ReactNode; confirm?: string; prompt?: string;
  variant?: "default" | "outline" | "destructive" | "ghost" | "secondary"; size?: "sm" | "default"; testId?: string;
}) {
  const [pending, start] = useTransition();
  return (
    <Button variant={variant} size={size} disabled={pending} data-testid={testId} onClick={() => {
      if (confirm && !window.confirm(confirm)) return;
      let input: string | undefined;
      if (prompt) { const v = window.prompt(prompt); if (v === null) return; input = v; }
      start(async () => {
        const r = await action(input);
        if (r.ok) toast.success(r.message ?? "OK"); else toast.error(r.error ?? "Erreur");
      });
    }}>
      {pending ? "…" : children}
    </Button>
  );
}
