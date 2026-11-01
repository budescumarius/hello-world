"use client";
import { PlayIcon } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { runAnalysisNow } from "@/app/(app)/_actions";
import { Button } from "@/components/ui/button";

export function RunAnalysisButton({ label, weekly = false }: { label: string; weekly?: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Button data-testid="run-analysis" disabled={pending} onClick={() => start(async () => {
      const r = await runAnalysisNow(weekly);
      if (r.ok) toast.success(r.message); else toast.error(r.error);
    })}>
      <PlayIcon /> {pending ? "Analyse en cours…" : label}
    </Button>
  );
}
