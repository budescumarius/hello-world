"use client";
import { useActionState, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { ActionState } from "@/lib/actions";

export type FormAction = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** Formulaire dans une boîte de dialogue, branché sur une Server Action (validation affichée champ par champ). */
export function FormDialog({ trigger, title, description, action, children, submitLabel = "Enregistrer", hidden }: {
  trigger: React.ReactNode; title: string; description?: string; action: FormAction; children: (errors: Record<string, string>) => React.ReactNode;
  submitLabel?: string; hidden?: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(async (prev: Awaited<ReturnType<FormAction>>, fd: FormData) => {
    const r = await action(prev, fd);
    if (r.ok) { toast.success(r.message ?? "Enregistré"); setOpen(false); }
    else if (r.error) toast.error(r.error);
    return r;
  }, { ok: false });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle>{description ? <DialogDescription>{description}</DialogDescription> : null}</DialogHeader>
        <form action={formAction} className="grid gap-4">
          {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <div className="grid gap-3 sm:grid-cols-2">{children(state.fieldErrors ?? {})}</div>
          {state.error && !state.ok ? <p role="alert" className="text-sm text-critical">{state.error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            <Button type="submit" disabled={pending}>{pending ? "…" : submitLabel}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
