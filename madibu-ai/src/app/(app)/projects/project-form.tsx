"use client";
import { PencilIcon, PlusIcon } from "lucide-react";
import { Field, SelectField, TextareaField } from "@/components/app/field";
import { FormDialog } from "@/components/app/form-dialog";
import { Button } from "@/components/ui/button";
import type { Messages } from "@/lib/i18n";
import { saveProject } from "../_actions";

type Opt = { value: string; label: string };
export interface ProjectRow {
  id?: string; reference?: string; name?: string; client_id?: string | null; site_address?: string | null; architect_name?: string | null;
  architect_email?: string | null; architect_phone?: string | null; engineer_name?: string | null; engineer_email?: string | null; status?: string;
  contract_amount_excl?: number | null; vat_rate?: number | null; start_date?: string | null; planned_end_date?: string | null; actual_end_date?: string | null;
  progress_pct?: number | null; budget_materials?: number | null; budget_labour?: number | null; budget_subcontract?: number | null; budget_other?: number | null;
  forecast_cost_override?: number | null; project_manager_id?: string | null; site_manager_id?: string | null; notes?: string | null;
}

export function ProjectDialog({ t, project, clients, profiles }: { t: Messages; project?: ProjectRow; clients: Opt[]; profiles: Opt[] }) {
  const p = project ?? {};
  const v = (x: unknown) => (x === null || x === undefined ? "" : String(x));
  const tp = t.projects;
  return (
    <FormDialog title={project ? `${t.common.edit} – ${p.reference}` : tp.new} action={saveProject} hidden={project?.id ? { $id: project.id } : undefined}
      trigger={project ? <Button variant="outline" size="sm"><PencilIcon />{t.common.edit}</Button> : <Button data-testid="new-project"><PlusIcon />{tp.new}</Button>}>
      {(e) => <>
        <Field name="reference" label={tp.reference} required defaultValue={v(p.reference)} error={e.reference} placeholder="MAD-2026-020" />
        <Field name="name" label={t.common.name} required defaultValue={v(p.name)} error={e.name} />
        <SelectField name="client_id" label={tp.client} options={clients} placeholder="—" defaultValue={p.client_id} error={e.client_id} />
        <SelectField name="status" label={t.common.status} required defaultValue={p.status ?? "offer"} error={e.status}
          options={Object.entries(t.projectStatus).map(([value, label]) => ({ value, label }))} />
        <Field name="site_address" label={tp.site} defaultValue={v(p.site_address)} className="sm:col-span-2" />
        <Field name="architect_name" label={tp.architect} defaultValue={v(p.architect_name)} />
        <Field name="architect_email" label={`${tp.architect} – ${t.common.email}`} type="email" defaultValue={v(p.architect_email)} error={e.architect_email} />
        <Field name="architect_phone" label={`${tp.architect} – ${t.common.phone}`} defaultValue={v(p.architect_phone)} />
        <Field name="engineer_name" label={tp.engineer} defaultValue={v(p.engineer_name)} />
        <Field name="contract_amount_excl" label={`${tp.contract} (€)`} inputMode="decimal" defaultValue={v(p.contract_amount_excl)} error={e.contract_amount_excl} />
        <SelectField name="vat_rate" label={tp.vatRate} placeholder="—" defaultValue={p.vat_rate === null || p.vat_rate === undefined ? "" : String(p.vat_rate)}
          options={[{ value: "6", label: "6 %" }, { value: "21", label: "21 %" }, { value: "12", label: "12 %" }, { value: "0", label: "0 % (autoliquidation)" }]} error={e.vat_rate} />
        <Field name="start_date" label={tp.start} type="date" defaultValue={v(p.start_date)} error={e.start_date} />
        <Field name="planned_end_date" label={tp.plannedEnd} type="date" defaultValue={v(p.planned_end_date)} error={e.planned_end_date} />
        <Field name="actual_end_date" label={tp.actualEnd} type="date" defaultValue={v(p.actual_end_date)} />
        <Field name="progress_pct" label={`${tp.progress} (%)`} type="number" min={0} max={100} step="1" defaultValue={v(p.progress_pct)} error={e.progress_pct} />
        <Field name="budget_materials" label={`${tp.budgetMaterials} (€)`} inputMode="decimal" defaultValue={v(p.budget_materials)} error={e.budget_materials} />
        <Field name="budget_labour" label={`${tp.budgetLabour} (€)`} inputMode="decimal" defaultValue={v(p.budget_labour)} error={e.budget_labour} />
        <Field name="budget_subcontract" label={`${tp.budgetSubcontract} (€)`} inputMode="decimal" defaultValue={v(p.budget_subcontract)} error={e.budget_subcontract} />
        <Field name="budget_other" label={`${tp.budgetOther} (€)`} inputMode="decimal" defaultValue={v(p.budget_other)} error={e.budget_other} />
        <Field name="forecast_cost_override" label={`${tp.forecastOverride} (€)`} inputMode="decimal" defaultValue={v(p.forecast_cost_override)} />
        <SelectField name="project_manager_id" label={tp.manager} options={profiles} placeholder="—" defaultValue={p.project_manager_id} />
        <SelectField name="site_manager_id" label={tp.siteManager} options={profiles} placeholder="—" defaultValue={p.site_manager_id} />
        <TextareaField name="notes" label={t.common.notes} defaultValue={v(p.notes)} />
      </>}
    </FormDialog>
  );
}
