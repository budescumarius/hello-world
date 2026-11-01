"use client";
import { CheckboxField, Field, SelectField } from "@/components/app/field";
import { FormDialog } from "@/components/app/form-dialog";
import { Button } from "@/components/ui/button";
import { saveChangeOrder } from "../../_actions";

export function ChangeOrderDialog({ projectId, title, descriptionLabel, amountLabel, today }: { projectId: string; title: string; descriptionLabel: string; amountLabel: string; today: string }) {
  return (
    <FormDialog title={title} action={saveChangeOrder} hidden={{ project_id: projectId }} trigger={<Button size="sm" variant="outline">+ {title}</Button>}>
      {(e) => <>
        <Field name="description" label={descriptionLabel} required className="sm:col-span-2" error={e.description} />
        <Field name="amount_excl" label={amountLabel} inputMode="decimal" error={e.amount_excl} />
        <SelectField name="status" label="Statut" defaultValue="requested" options={[{ value: "requested", label: "Demandé" }, { value: "quoted", label: "Chiffré" }, { value: "approved", label: "Accord écrit reçu" }, { value: "rejected", label: "Refusé" }]} />
        <Field name="requested_on" label="Demandé le" type="date" required defaultValue={today} />
        <Field name="approved_on" label="Accord écrit le" type="date" error={e.approved_on} />
        <CheckboxField name="work_started" label="Travaux déjà commencés" />
      </>}
    </FormDialog>
  );
}
