"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateProgress } from "@/app/(app)/_actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ProgressForm({ projectId, value, label }: { projectId: string; value: number | null; label: string }) {
  const [v, setV] = useState(value === null ? "" : String(value));
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <Input type="number" min={0} max={100} step={1} value={v} onChange={(e) => setV(e.target.value)} className="w-24" aria-label={label} />
      <Button size="sm" variant="outline" disabled={pending || v === ""} onClick={() => start(async () => {
        const r = await updateProgress(projectId, Number(v));
        if (r.ok) toast.success(r.message); else toast.error(r.error);
      })}>{label}</Button>
    </div>
  );
}
