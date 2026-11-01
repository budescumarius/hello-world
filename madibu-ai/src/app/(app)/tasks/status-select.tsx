"use client";
import { useTransition } from "react";
import { toast } from "sonner";
import { NativeSelect } from "@/components/ui/native-select";
import { setTaskStatus } from "../_actions";

export function StatusSelect({ id, value, labels }: { id: string; value: string; labels: Record<string, string> }) {
  const [pending, start] = useTransition();
  return (
    <NativeSelect aria-label="Statut" className="h-8 w-36 text-xs" defaultValue={value} disabled={pending} data-testid={`status-${id}`}
      onChange={(e) => { const s = e.target.value; start(async () => { const r = await setTaskStatus(id, s); if (!r.ok) toast.error(r.error); }); }}>
      {Object.entries(labels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </NativeSelect>
  );
}
