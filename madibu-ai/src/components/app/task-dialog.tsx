"use client";
import { PlusIcon } from "lucide-react";
import { saveTask } from "@/app/(app)/_actions";
import { Field, SelectField, TextareaField } from "@/components/app/field";
import { FormDialog } from "@/components/app/form-dialog";
import { Button } from "@/components/ui/button";
import type { Messages } from "@/lib/i18n";

type Opt = { value: string; label: string };
export function TaskDialog({ t, projects, profiles, projectId, task }: {
  t: Messages; projects: Opt[]; profiles: Opt[]; projectId?: string;
  task?: { id: string; title: string; description: string | null; project_id: string | null; assigned_to: string | null; priority: string; status: string; due_date: string | null };
}) {
  return (
    <FormDialog title={task ? task.title : t.tasks.new} action={saveTask} hidden={task ? { $id: task.id } : undefined}
      trigger={task ? <Button variant="ghost" size="sm">{t.common.edit}</Button> : <Button size="sm" data-testid="new-task"><PlusIcon />{t.tasks.new}</Button>}>
      {(e) => <>
        <Field name="title" label={t.common.name} required defaultValue={task?.title} error={e.title} className="sm:col-span-2" />
        <SelectField name="project_id" label={t.common.project} options={projects} placeholder="—" defaultValue={task?.project_id ?? projectId} />
        <SelectField name="assigned_to" label={t.tasks.assignee} options={profiles} placeholder="—" defaultValue={task?.assigned_to} />
        <SelectField name="priority" label={t.tasks.priority} defaultValue={task?.priority ?? "normal"} options={Object.entries(t.tasks.priorities).map(([value, label]) => ({ value, label }))} />
        <SelectField name="status" label={t.common.status} defaultValue={task?.status ?? "todo"} options={Object.entries(t.tasks.status).map(([value, label]) => ({ value, label }))} />
        <Field name="due_date" label={t.tasks.due} type="date" defaultValue={task?.due_date ?? ""} error={e.due_date} />
        <TextareaField name="description" label={t.common.description} defaultValue={task?.description ?? ""} />
      </>}
    </FormDialog>
  );
}
