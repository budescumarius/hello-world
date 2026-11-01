"use client";
import { PencilIcon, PlusIcon } from "lucide-react";
import { CheckboxField, Field, SelectField, TextareaField } from "@/components/app/field";
import { FormDialog } from "@/components/app/form-dialog";
import { Button } from "@/components/ui/button";
import type { Messages } from "@/lib/i18n";
import { saveClient, saveEmployee, saveSubcontractor, saveSupplier } from "../_actions";

export type PartyKind = "clients" | "suppliers" | "subcontractors" | "employees";
type Row = Record<string, unknown> & { id?: string };
const ACTIONS = { clients: saveClient, suppliers: saveSupplier, subcontractors: saveSubcontractor, employees: saveEmployee };

export function PartyDialog({ kind, t, row }: { kind: PartyKind; t: Messages; row?: Row }) {
  const v = (k: string) => (row?.[k] === null || row?.[k] === undefined ? "" : Array.isArray(row[k]) ? (row[k] as string[]).join(", ") : String(row[k]));
  const tp = t.parties;
  const newLabel = { clients: tp.newClient, suppliers: tp.newSupplier, subcontractors: tp.newSubcontractor, employees: tp.newEmployee }[kind];
  return (
    <FormDialog title={row ? `${t.common.edit} – ${v(kind === "employees" ? "full_name" : "name")}` : newLabel} action={ACTIONS[kind]} hidden={row?.id ? { $id: row.id } : undefined}
      trigger={row ? <Button variant="ghost" size="sm"><PencilIcon /></Button> : <Button data-testid={`new-${kind}`}><PlusIcon />{newLabel}</Button>}>
      {(e) => kind === "employees" ? <>
        <Field name="full_name" label={t.common.name} required defaultValue={v("full_name")} error={e.full_name} />
        <Field name="job_title" label={tp.jobTitle} defaultValue={v("job_title")} />
        <Field name="email" label={t.common.email} type="email" defaultValue={v("email")} error={e.email} />
        <Field name="phone" label={t.common.phone} defaultValue={v("phone")} />
        <Field name="hourly_cost" label={`${tp.hourlyCost} (€)`} inputMode="decimal" defaultValue={v("hourly_cost")} error={e.hourly_cost} />
        <Field name="hired_on" label="Entrée en service" type="date" defaultValue={v("hired_on")} />
        <CheckboxField name="active" label={tp.active} defaultChecked={row ? row.active !== false : true} />
        <TextareaField name="notes" label={t.common.notes} defaultValue={v("notes")} />
      </> : <>
        <Field name="name" label={t.common.name} required defaultValue={v("name")} error={e.name} />
        {kind === "clients" ? <SelectField name="client_type" label={tp.clientType} defaultValue={v("client_type") || "company"} options={Object.entries(tp.types).map(([value, label]) => ({ value, label }))} /> : null}
        {kind === "subcontractors" ? <Field name="trade" label={tp.trade} defaultValue={v("trade")} /> : null}
        <Field name="vat_number" label={tp.vat} defaultValue={v("vat_number")} placeholder="BE0123456789" />
        <Field name="email" label={t.common.email} type="email" defaultValue={v("email")} error={e.email} />
        <Field name="phone" label={t.common.phone} defaultValue={v("phone")} />
        <Field name="contact_person" label={t.common.contact} defaultValue={v("contact_person")} />
        <Field name="address" label={t.common.address} defaultValue={v("address")} className="sm:col-span-2" />
        <Field name="payment_terms_days" label={tp.terms} type="number" min={0} max={180} defaultValue={v("payment_terms_days")} error={e.payment_terms_days} />
        {kind === "suppliers" ? <Field name="categories" label={tp.categories} defaultValue={v("categories")} placeholder="briques, bois, sanitaire" /> : null}
        {kind === "subcontractors" ? <Field name="insurance_valid_until" label={tp.insurance} type="date" defaultValue={v("insurance_valid_until")} /> : null}
        <TextareaField name="notes" label={t.common.notes} defaultValue={v("notes")} />
      </>}
    </FormDialog>
  );
}
