import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { loadCompanyData } from "@/lib/data/company";
import { daysBetween, todayBrussels } from "@/lib/dates";
import { paidByInvoice, paymentStatus } from "@/lib/domain/finance";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

/** Rapport financier (CSV) : toutes les factures émises et reçues avec payé / solde / retard. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
  if (!can(user.role, "finance.view")) return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  const today = todayBrussels();
  const data = await loadCompanyData(await createClient());
  const names = new Map([...data.clients, ...data.suppliers, ...data.subcontractors].map((p) => [p.id, p.name]));
  const projects = new Map(data.projects.map((p) => [p.id, p.reference]));
  const paid = paidByInvoice(data.payments);
  const rows = data.invoices.map((i) => {
    const p = paid.get(i.id) ?? 0, open = i.amount_total - p;
    return [i.direction === "issued" ? "émise" : "reçue", i.number, i.kind, names.get(i.client_id ?? i.supplier_id ?? i.subcontractor_id ?? "") ?? "", projects.get(i.project_id ?? "") ?? "",
      i.cost_category, i.issue_date, i.due_date, i.amount_excl / 100, i.vat_amount / 100, i.amount_total / 100, p / 100, open / 100, i.status,
      ["cancelled", "draft"].includes(i.status) ? "" : paymentStatus(i.amount_total, p), open > 0 ? Math.max(0, daysBetween(i.due_date, today)) : 0];
  });
  const csv = toCsv(["sens", "numero", "type", "tiers", "chantier", "poste", "date", "echeance", "htva", "tva", "tvac", "paye", "solde", "statut", "paiement", "jours_retard"], rows);
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="madibu-finances-${today}.csv"` } });
}
