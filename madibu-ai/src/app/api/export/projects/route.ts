import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { loadCompanyData } from "@/lib/data/company";
import { todayBrussels } from "@/lib/dates";
import { projectFinancials } from "@/lib/domain/finance";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

const e = (c: number | null) => (c === null ? null : c / 100);
const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

/** Rapport chantiers (CSV) : indicateurs financiers par chantier, données visibles selon la RLS de l'utilisateur. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentification requise" }, { status: 401 });
  if (!can(user.role, "export.run")) return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  const today = todayBrussels();
  const data = await loadCompanyData(await createClient());
  const clients = new Map(data.clients.map((c) => [c.id, c.name]));
  const rows = data.projects.filter((p) => !p.archived_at).map((p) => {
    const f = projectFinancials(p, data, today);
    return [p.reference, p.name, clients.get(p.client_id ?? "") ?? "", p.status, p.start_date, p.planned_end_date, r1(f.progressPct), e(f.totalContractExcl),
      e(f.invoicedExcl), e(f.collected), e(f.costs.materials), e(f.costs.labour), e(f.costs.subcontract), e(f.costs.other), e(f.costsIncurred), e(f.costsPaid),
      e(f.budgetTotal), e(f.remainingBudget), e(f.forecastFinalCost), f.forecastMethod, e(f.estimatedProfit), r1(f.estimatedMarginPct), f.daysLate, f.missing.join(" | ")];
  });
  const csv = toCsv(["reference", "nom", "client", "statut", "debut", "fin_prevue", "avancement_pct", "contrat_htva", "facture_htva", "encaisse_tvac",
    "materiaux", "main_oeuvre", "sous_traitance", "autres", "couts_engages_htva", "couts_payes_tvac", "budget", "budget_restant", "cout_final_estime",
    "methode_estimation", "benefice_estime", "marge_estimee_pct", "retard_jours", "donnees_manquantes"], rows);
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="madibu-chantiers-${today}.csv"` } });
}
