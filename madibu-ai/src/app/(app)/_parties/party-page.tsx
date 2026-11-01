import { ActionButton } from "@/components/app/action-button";
import { PageHeader } from "@/components/app/page-header";
import { SeverityBadge } from "@/components/app/severity";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth";
import { loadCompanyData } from "@/lib/data/company";
import { daysBetween, formatDate, todayBrussels } from "@/lib/dates";
import { payables, receivables } from "@/lib/domain/finance";
import { getMessages } from "@/lib/i18n";
import { formatEur, sum } from "@/lib/money";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { setPartyArchived } from "../_actions";
import { PartyDialog, type PartyKind } from "./party-dialog";

/** Page générique Clients / Fournisseurs / Sous-traitants / Employés. */
export async function PartyPage({ kind, archived }: { kind: PartyKind; archived?: boolean }) {
  const user = await requirePermission(kind === "employees" ? "employees.view" : "parties.view");
  const t = getMessages(user.locale);
  const sb = await createClient();
  const today = todayBrussels();
  const write = can(user.role, kind === "clients" ? "clients.write" : kind === "employees" ? "employees.write" : "suppliers.write");
  let query = sb.from(kind).select("*").order(kind === "employees" ? "full_name" : "name");
  if (kind !== "employees") query = archived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  const { data: rows } = await query;
  const finance = can(user.role, "finance.view");
  const data = finance && kind !== "employees" ? await loadCompanyData(sb) : null;
  const open = new Map<string, number>();
  if (data) for (const r of kind === "clients" ? receivables(data, today) : payables(data, today)) if (r.party_id) open.set(r.party_id, (open.get(r.party_id) ?? 0) + r.open);
  const title = t.nav[kind];

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={title} actions={<>
        {kind !== "employees" ? <a className="inline-flex h-9 items-center rounded-md border bg-card px-3 text-sm" href={archived ? `/${kind}` : `/${kind}?archived=1`}>{archived ? t.common.back : t.common.showArchived}</a> : null}
        {write ? <PartyDialog kind={kind} t={t} /> : null}</>} />
      <Card><CardContent className="overflow-x-auto">
        {!rows?.length ? <p className="text-sm text-muted-foreground">{t.common.none}</p> : (
          <table className="w-full text-sm" data-testid={`${kind}-table`}><thead><tr className="border-b text-xs text-muted-foreground">
            <th className="py-2 text-left">{t.common.name}</th>
            <th className="text-left">{kind === "employees" ? t.parties.jobTitle : kind === "subcontractors" ? t.parties.trade : kind === "suppliers" ? t.parties.categories : t.parties.clientType}</th>
            <th className="text-left">{t.common.email}</th><th className="text-left">{t.common.phone}</th>
            {kind === "employees" ? <th className="text-right">{t.parties.hourlyCost}</th> : <th className="text-right">{t.parties.terms}</th>}
            {kind === "subcontractors" ? <th className="pl-3 text-left">{t.parties.insurance}</th> : null}
            {data ? <th className="text-right">{t.parties.outstanding}</th> : null}<th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="border-b last:border-0">
                <td className="py-2 font-medium">{r.name ?? r.full_name}{r.vat_number ? <div className="text-xs font-normal text-muted-foreground">{r.vat_number}</div> : null}</td>
                <td>{kind === "employees" ? r.job_title : kind === "subcontractors" ? r.trade : kind === "suppliers" ? (r.categories ?? []).join(", ") : t.parties.types[r.client_type as keyof typeof t.parties.types]}
                  {kind === "employees" && !r.active ? <Badge variant="outline" className="ml-1">inactif</Badge> : null}</td>
                <td>{r.email ?? <span className="text-muted-foreground">—</span>}</td><td>{r.phone ?? "—"}</td>
                <td className="text-right tabular">{kind === "employees" ? formatEur(r.hourly_cost === null ? null : Math.round(r.hourly_cost * 100)) : r.payment_terms_days ?? "—"}</td>
                {kind === "subcontractors" ? <td className="pl-3">{r.insurance_valid_until ? (daysBetween(today, r.insurance_valid_until) < 0
                  ? <SeverityBadge severity="high" label={`expirée ${formatDate(r.insurance_valid_until, user.locale)}`} /> : formatDate(r.insurance_valid_until, user.locale)) : <span className="text-muted-foreground">non renseignée</span>}</td> : null}
                {data ? <td className="text-right tabular">{formatEur(open.get(r.id) ?? 0, { digits: 0 })}</td> : null}
                <td className="text-right whitespace-nowrap">{write ? <><PartyDialog kind={kind} t={t} row={r} />
                  {kind !== "employees" ? <ActionButton variant="ghost" action={setPartyArchived.bind(null, kind, r.id, !archived)}>{archived ? t.common.unarchive : t.common.archive}</ActionButton> : null}</> : null}</td>
              </tr>))}</tbody>
            {data ? <tfoot><tr><td colSpan={kind === "subcontractors" ? 6 : 5} className="pt-2 text-right text-xs text-muted-foreground">{t.common.total}</td><td className="pt-2 text-right font-semibold tabular">{formatEur(sum([...open.values()]), { digits: 0 })}</td><td /></tr></tfoot> : null}
          </table>)}
      </CardContent></Card>
    </div>
  );
}
