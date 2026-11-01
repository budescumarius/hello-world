"use client";
import { PlusIcon } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { CheckboxField, Field, SelectField, TextareaField } from "@/components/app/field";
import { FormDialog } from "@/components/app/form-dialog";
import { Button } from "@/components/ui/button";
import type { Messages } from "@/lib/i18n";
import {
  confirmObligationPaid, saveBankBalance, saveExpense, saveIssuedInvoice, saveObligation, savePayment, saveReceivedInvoice,
} from "../_actions";

type Opt = { value: string; label: string };
const VAT = [{ value: "21", label: "21 %" }, { value: "6", label: "6 %" }, { value: "12", label: "12 %" }, { value: "0", label: "0 % (autoliquidation)" }];
const today = () => new Date().toISOString().slice(0, 10);
const plus = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

export function IssuedInvoiceDialog({ t, clients, projects }: { t: Messages; clients: Opt[]; projects: Opt[] }) {
  return (
    <FormDialog title={`${t.finance.newInvoice} – ${t.finance.customerInvoices}`} action={saveIssuedInvoice}
      description="Enregistre une facture émise par votre logiciel de facturation. L'IA n'émet jamais de facture."
      trigger={<Button size="sm" data-testid="new-issued-invoice"><PlusIcon />{t.finance.newInvoice}</Button>}>
      {(e) => <>
        <Field name="number" label={t.finance.number} required error={e.number} />
        <SelectField name="kind" label="Type" defaultValue="progress" options={Object.entries(t.finance.kind).map(([value, label]) => ({ value, label }))} />
        <SelectField name="client_id" label={t.projects.client} required options={clients} placeholder="—" error={e.client_id} />
        <SelectField name="project_id" label={t.common.project} options={projects} placeholder="—" />
        <Field name="issue_date" label={t.finance.issueDate} type="date" required defaultValue={today()} error={e.issue_date} />
        <Field name="due_date" label={t.finance.dueDate} type="date" required defaultValue={plus(30)} error={e.due_date} />
        <Field name="amount_excl" label={`${t.common.amount} ${t.common.excl} (€)`} required inputMode="decimal" error={e.amount_excl} />
        <SelectField name="vat_rate" label={t.common.vat} defaultValue="6" options={VAT} error={e.vat_rate} />
        <SelectField name="status" label={t.common.status} defaultValue="issued" options={["issued", "draft", "disputed", "cancelled"].map((k) => ({ value: k, label: t.finance.invoiceStatus[k as keyof typeof t.finance.invoiceStatus] }))} />
        <TextareaField name="notes" label={t.common.notes} />
      </>}
    </FormDialog>
  );
}

export function ReceivedInvoiceDialog({ t, parties, projects }: { t: Messages; parties: Opt[]; projects: Opt[] }) {
  return (
    <FormDialog title={`${t.finance.newInvoice} – ${t.finance.supplierInvoices}`} action={saveReceivedInvoice}
      trigger={<Button size="sm" data-testid="new-received-invoice"><PlusIcon />{t.finance.newInvoice}</Button>}>
      {(e) => <>
        <SelectField name="party" label={t.finance.supplier} required options={parties} placeholder="—" error={e.party} className="sm:col-span-2" />
        <Field name="number" label={t.finance.number} required error={e.number} />
        <SelectField name="project_id" label={t.common.project} options={projects} placeholder="— (frais généraux)" />
        <SelectField name="cost_category" label={t.finance.category} defaultValue="materials" options={Object.entries(t.categories).map(([value, label]) => ({ value, label }))} />
        <SelectField name="status" label={t.common.status} defaultValue="received" options={["received", "approved", "disputed", "cancelled"].map((k) => ({ value: k, label: t.finance.invoiceStatus[k as keyof typeof t.finance.invoiceStatus] }))} />
        <Field name="issue_date" label={t.finance.issueDate} type="date" required defaultValue={today()} error={e.issue_date} />
        <Field name="due_date" label={t.finance.dueDate} type="date" required defaultValue={plus(30)} error={e.due_date} />
        <Field name="amount_excl" label={`${t.common.amount} ${t.common.excl} (€)`} required inputMode="decimal" error={e.amount_excl} />
        <SelectField name="vat_rate" label={t.common.vat} defaultValue="21" options={VAT} />
      </>}
    </FormDialog>
  );
}

export function ExpenseDialog({ t, projects, employees }: { t: Messages; projects: Opt[]; employees: Opt[] }) {
  return (
    <FormDialog title={t.finance.newExpense} action={saveExpense} trigger={<Button size="sm" data-testid="new-expense"><PlusIcon />{t.finance.newExpense}</Button>}
      description="Coûts sans facture d'achat : main-d'œuvre interne, achats comptant, carburant…">
      {(e) => <>
        <Field name="description" label={t.common.description} required error={e.description} className="sm:col-span-2" />
        <SelectField name="category" label={t.finance.category} defaultValue="labour" options={Object.entries(t.categories).map(([value, label]) => ({ value, label }))} />
        <SelectField name="project_id" label={t.common.project} options={projects} placeholder="—" />
        <SelectField name="employee_id" label={t.nav.employees} options={employees} placeholder="—" />
        <Field name="expense_date" label={t.common.date} type="date" required defaultValue={today()} />
        <Field name="hours" label="Heures" type="number" step="0.5" min={0} />
        <Field name="amount_excl" label={`${t.common.amount} ${t.common.excl} (€)`} required inputMode="decimal" error={e.amount_excl} />
        <SelectField name="vat_rate" label={t.common.vat} defaultValue="0" options={VAT} />
        <SelectField name="settlement" label={t.finance.settlement} defaultValue="payroll" options={[{ value: "payroll", label: "Main-d'œuvre interne (via les salaires)" }, { value: "payable", label: "À payer (dette)" }]} />
        <CheckboxField name="paid_now" label="Déjà payée (enregistrer le paiement à la date de la dépense)" />
      </>}
    </FormDialog>
  );
}

export function PaymentDialog({ t, direction, invoiceId, expenseId, open, label }: { t: Messages; direction: "in" | "out"; invoiceId?: string; expenseId?: string; open: number; label: string }) {
  const hidden: Record<string, string> = { direction };
  if (invoiceId) hidden.invoice_id = invoiceId;
  if (expenseId) hidden.expense_id = expenseId;
  return (
    <FormDialog title={`${t.finance.newPayment} – ${label}`} action={savePayment} hidden={hidden} submitLabel={t.common.save}
      description="N'enregistrez qu'un paiement constaté sur le relevé bancaire."
      trigger={<Button size="sm" variant="outline" data-testid={`pay-${invoiceId ?? expenseId}`}>{direction === "in" ? "Encaissement" : "Paiement"}</Button>}>
      {(e) => <>
        <Field name="amount" label={`${t.common.amount} ${t.common.incl} (€)`} required inputMode="decimal" defaultValue={(open / 100).toFixed(2)} error={e.amount} />
        <Field name="payment_date" label={t.common.date} type="date" required defaultValue={today()} error={e.payment_date} />
        <SelectField name="method" label={t.finance.method} defaultValue="bank_transfer" options={[{ value: "bank_transfer", label: "Virement" }, { value: "direct_debit", label: "Domiciliation" }, { value: "card", label: "Carte" }, { value: "cash", label: "Espèces" }, { value: "other", label: "Autre" }]} />
        <Field name="reference" label={t.finance.reference} />
      </>}
    </FormDialog>
  );
}

export function BankBalanceDialog({ t, accounts }: { t: Messages; accounts: string[] }) {
  return (
    <FormDialog title={t.finance.newBalance} action={saveBankBalance} description={t.finance.manualBalance}
      trigger={<Button size="sm" data-testid="new-balance"><PlusIcon />{t.finance.newBalance}</Button>}>
      {(e) => <>
        <Field name="account_label" label="Compte" required list="accounts" error={e.account_label} />
        <datalist id="accounts">{accounts.map((a) => <option key={a} value={a} />)}</datalist>
        <Field name="as_of" label={t.common.date} type="date" required defaultValue={today()} />
        <Field name="balance" label="Solde (€)" required inputMode="decimal" error={e.balance} />
      </>}
    </FormDialog>
  );
}

export function ObligationDialog({ t }: { t: Messages }) {
  const kinds: Record<string, string> = { loan: "Prêt", credit_facility: "Ligne de crédit", leasing: "Leasing", salary: "Salaires", social_security: "ONSS", tax: "TVA / impôts", rent: "Loyer", insurance: "Assurance", other: "Autre" };
  return (
    <FormDialog title={t.finance.newObligation} action={saveObligation} trigger={<Button size="sm" variant="outline"><PlusIcon />{t.finance.newObligation}</Button>}>
      {(e) => <>
        <Field name="label" label={t.common.description} required error={e.label} className="sm:col-span-2" />
        <SelectField name="kind" label="Type" defaultValue="loan" options={Object.entries(kinds).map(([value, label]) => ({ value, label }))} />
        <Field name="counterparty" label="Organisme" />
        <Field name="amount" label={`${t.common.amount} (€)`} required inputMode="decimal" error={e.amount} />
        <SelectField name="frequency" label="Fréquence" defaultValue="monthly" options={[{ value: "monthly", label: "Mensuelle" }, { value: "quarterly", label: "Trimestrielle" }, { value: "yearly", label: "Annuelle" }, { value: "once", label: "Unique" }]} />
        <Field name="next_due_date" label="Prochaine échéance" type="date" required error={e.next_due_date} />
        <Field name="end_date" label="Fin" type="date" />
      </>}
    </FormDialog>
  );
}

export function ConfirmObligation({ id, label }: { id: string; label: string }) {
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={() => {
      const d = window.prompt("Date du paiement constaté (AAAA-MM-JJ)", today());
      if (!d) return;
      start(async () => { const r = await confirmObligationPaid(id, d); if (r.ok) toast.success(r.message); else toast.error(r.error); });
    }}>{label}</Button>
  );
}
