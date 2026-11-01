"use client";
import { useTransition } from "react";
import { toast } from "sonner";
import { Field, SelectField } from "@/components/app/field";
import { FormDialog } from "@/components/app/form-dialog";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { createUser, setUserRole } from "../_actions";

export function RoleSelect({ id, role, active, roles, self }: { id: string; role: string; active: boolean; roles: Record<string, string>; self: boolean }) {
  const [pending, start] = useTransition();
  const go = (r: string, a: boolean) => start(async () => { const res = await setUserRole(id, r, a); if (res.ok) toast.success(res.message); else toast.error(res.error); });
  return (
    <div className="flex items-center gap-2">
      <NativeSelect className="h-8 w-44 text-xs" defaultValue={role} disabled={pending} onChange={(e) => go(e.target.value, active)} aria-label="Rôle">
        {Object.entries(roles).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </NativeSelect>
      {!self ? <Button size="sm" variant="ghost" disabled={pending} onClick={() => go(role, !active)}>{active ? "Désactiver" : "Réactiver"}</Button> : null}
    </div>
  );
}

export function NewUserDialog({ roles, label }: { roles: Record<string, string>; label: string }) {
  return (
    <FormDialog title={label} action={createUser} trigger={<Button size="sm">{label}</Button>} description="Communiquez le mot de passe initial par un canal sûr ; l'utilisateur pourra le changer.">
      {(e) => <>
        <Field name="full_name" label="Nom complet" required error={e.full_name} />
        <Field name="email" label="E-mail" type="email" required error={e.email} />
        <SelectField name="role" label="Rôle" defaultValue="employee" options={Object.entries(roles).map(([value, label]) => ({ value, label }))} />
        <Field name="password" label="Mot de passe initial (12 caractères min.)" type="password" required minLength={12} error={e.password} autoComplete="new-password" />
      </>}
    </FormDialog>
  );
}
