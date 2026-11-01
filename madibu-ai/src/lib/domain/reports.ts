/** Rapports générés à partir des données réelles (Markdown) + textes de relance. */
import { addDays, formatDate } from "../dates";
import { type Cents, formatEur, formatPct, sum } from "../money";
import { type Finding, MISSING_LABELS } from "./analysis";
import {
  allForecasts, bankPosition, companySummary, HORIZONS, isActive, obligationOccurrences, payables, projectFinancials,
  receivables, SCENARIOS, type Scenario,
} from "./finance";
import type { CompanyData } from "./types";

const eur = (c: Cents | null) => formatEur(c, { digits: 0 });
const SC_LABEL: Record<Scenario, string> = { optimistic: "Optimiste", realistic: "Réaliste", pessimistic: "Pessimiste" };
const FREQ: Record<string, string> = { once: "unique", monthly: "mois", quarterly: "trimestre", yearly: "an" };
const SEV: Record<string, string> = { critical: "🔴 CRITIQUE", high: "🟠 ÉLEVÉ", warning: "🟡 ATTENTION", info: "🔵 INFO" };

function partyName(data: CompanyData, id: string | null) {
  if (!id) return "—";
  return [...data.clients, ...data.suppliers, ...data.subcontractors].find((p) => p.id === id)?.name ?? "—";
}

export const DAILY_FINANCIAL_TITLE = "MADIBU – DAILY FINANCIAL REPORT";

export function dailyFinancialReport(data: CompanyData, findings: Finding[], today: string): { title: string; markdown: string; data: Record<string, unknown> } {
  const s = companySummary(data, today);
  const bank = bankPosition(data.bankBalances, today);
  const fc = allForecasts(data, today);
  const rec = receivables(data, today);
  const pay = payables(data, today);
  const L: string[] = [`# ${DAILY_FINANCIAL_TITLE}`, "", `**Date : ${formatDate(today)}** · Montants de rentabilité HTVA, flux de trésorerie TVAC.`, ""];

  L.push("## 1. Trésorerie disponible", "");
  if (!bank.known) L.push("- **Aucun solde bancaire saisi.** Trésorerie disponible inconnue : saisir les soldes (Finances → Banque).");
  else {
    L.push(`- **${eur(bank.balance)}** (saisie manuelle, au ${formatDate(bank.asOf)}${(bank.ageDays ?? 0) > 7 ? ` – ⚠ donnée de ${bank.ageDays} j` : ""})`);
    for (const a of bank.accounts) L.push(`  - ${a.account_label} : ${eur(a.balance)} (${formatDate(a.as_of)}, ${a.source === "manual" ? "saisi manuellement" : a.source})`);
  }
  L.push("", "| Scénario | Solde à 7 j | Solde à 30 j | Solde à 90 j | Point bas (90 j) |", "|---|---|---|---|---|");
  for (const sc of SCENARIOS) {
    const h = fc[sc].horizons;
    L.push(`| ${SC_LABEL[sc]} | ${eur(h[7].closing)} | ${eur(h[30].closing)} | ${eur(h[90].closing)} | ${eur(h[90].minBalance)}${h[90].minDate ? ` (${formatDate(h[90].minDate)})` : ""} |`);
  }
  L.push("");

  L.push("## 2. Encaissements attendus", "");
  const due30 = rec.filter((r) => !r.disputed && r.due_date <= addDays(today, 30));
  L.push(`- Créances ouvertes : **${eur(s.receivablesOpen)}** TVAC, dont **${eur(s.receivablesOverdue)} en retard** (${s.overdueInvoiceCount} facture(s)).`);
  L.push(`- Échéances clients à 30 j (y compris retards) : ${eur(sum(due30.map((r) => r.open)))}. Encaissements prévus à 30 j : optimiste ${eur(fc.optimistic.horizons[30].inflow)} · réaliste ${eur(fc.realistic.horizons[30].inflow)} · pessimiste ${eur(fc.pessimistic.horizons[30].inflow)}.`);
  L.push(`- Rappel : facturé HTVA ${eur(s.revenueInvoicedExcl)} ≠ encaissé ${eur(s.cashCollected)} TVAC.`, "");

  L.push("## 3. Paiements à effectuer", "");
  const in30 = pay.filter((p) => !p.disputed && p.due_date <= addDays(today, 30));
  const obl = obligationOccurrences(data.obligations, today, addDays(today, 30), true);
  for (const p of in30.slice(0, 12)) L.push(`- ${formatDate(p.due_date)}${p.daysOverdue > 0 ? " **(échu)**" : ""} – ${partyName(data, p.party_id)} ${p.number} : ${eur(p.open)}`);
  for (const o of obl.slice(0, 12)) L.push(`- ${formatDate(o.date)}${o.overdue ? " **(non confirmé)**" : ""} – ${o.label} : ${eur(o.amount)}`);
  if (!in30.length && !obl.length) L.push("- Aucun paiement prévu à 30 jours.");
  L.push(`- **Total à 30 j : ${eur(sum(in30.map((p) => p.open)) + sum(obl.map((o) => o.amount)))}**`, "");

  L.push("## 4. Dettes en cours", "");
  const subIds = new Set(data.subcontractors.map((x) => x.id));
  L.push(`- Fournisseurs : ${eur(sum(pay.filter((p) => !subIds.has(p.party_id ?? "")).map((p) => p.open)))} · Sous-traitants : ${eur(sum(pay.filter((p) => subIds.has(p.party_id ?? "")).map((p) => p.open)))} · dont échu : **${eur(s.payablesOverdue)}**`);
  const loans = data.obligations.filter((o) => o.active && ["loan", "credit_facility", "leasing"].includes(o.kind));
  if (loans.length) L.push(`- Prêts, crédits et leasings actifs : ${loans.map((o) => `${o.label} (${eur(o.amount)} / ${FREQ[o.frequency]})`).join(" ; ")}`);
  L.push("");

  L.push("## 5. Chantiers à risque financier", "");
  const risky = data.projects.filter(isActive).map((p) => ({ p, f: projectFinancials(p, data, today) }))
    .filter(({ f }) => (f.estimatedMarginPct !== null && f.estimatedMarginPct < 10) || (f.budgetTotal !== null && f.costsIncurred > f.budgetTotal) || f.missing.length);
  if (!risky.length) L.push("- Aucun chantier actif signalé.");
  else {
    L.push("| Chantier | Contrat HTVA | Facturé | Encaissé | Coûts engagés | Coût final estimé | Marge estimée | Données manquantes |", "|---|---|---|---|---|---|---|---|");
    for (const { p, f } of risky) L.push(`| ${p.reference} ${p.name} | ${eur(f.totalContractExcl)} | ${eur(f.invoicedExcl)} | ${eur(f.collected)} | ${eur(f.costsIncurred)} | ${eur(f.forecastFinalCost)} | ${formatPct(f.estimatedMarginPct)} | ${f.missing.map((m) => MISSING_LABELS[m] ?? m).join(", ") || "—"} |`);
  }
  L.push("");

  const crit = findings.filter((x) => x.severity === "critical" || x.severity === "high");
  L.push("## 6. Alertes critiques", "");
  if (!crit.length) L.push("- Aucune alerte critique ou élevée.");
  for (const x of crit) L.push(`- ${SEV[x.severity]} **${x.title}** — ${x.why}${x.impactAmount ? ` Impact : ${eur(x.impactAmount)}.` : ""}`);
  L.push("");

  L.push("## 7. Actions recommandées", "");
  const actions = findings.filter((x) => x.severity !== "info").slice(0, 12);
  if (!actions.length) L.push("- Aucune action requise.");
  actions.forEach((x, i) => L.push(`${i + 1}. ${x.recommendation} — _${x.title}_ · **Qui :** ${x.responsible} · **Quand :** ${x.dueDate ? formatDate(x.dueDate) : "à planifier"}`));
  L.push("", "_Aucun paiement, envoi d'e-mail, commande ou facture n'a été exécuté automatiquement. Les actions externes attendent une approbation._");

  return {
    title: DAILY_FINANCIAL_TITLE,
    markdown: L.join("\n"),
    data: {
      summary: s,
      forecasts: Object.fromEntries(SCENARIOS.map((sc) => [sc, { horizons: fc[sc].horizons, excluded: fc[sc].excludedReceivables }])),
      horizons: HORIZONS,
      findings: findings.length,
    },
  };
}

export function weeklyProjectsReport(data: CompanyData, findings: Finding[], today: string) {
  const L = [`# MADIBU – RAPPORT HEBDOMADAIRE DES CHANTIERS`, "", `**Semaine du ${formatDate(today)}**`, ""];
  const projects = data.projects.filter((p) => !p.archived_at && p.status !== "cancelled");
  L.push("| Chantier | Statut | Avancement (déclaré / attendu) | Fin prévue | Retard | Budget consommé | Marge estimée | Non facturé |", "|---|---|---|---|---|---|---|---|");
  for (const p of projects) {
    const f = projectFinancials(p, data, today);
    L.push(`| ${p.reference} ${p.name} | ${p.status} | ${formatPct(f.progressPct)} / ${formatPct(f.plannedProgressPct)} | ${formatDate(p.planned_end_date)} | ${f.daysLate ? f.daysLate + " j" : "—"} | ${formatPct(f.budgetUsedPct)} | ${formatPct(f.estimatedMarginPct)} | ${f.unbilledWork && f.unbilledWork > 0 ? eur(f.unbilledWork) : "—"} |`);
  }
  L.push("", "_Avancement « déclaré » = saisi par le chantier ; « attendu » = estimation linéaire entre les dates de début et de fin. Un avancement déclaré n'est pas une réception de travaux._", "");
  for (const p of projects) {
    const pf = findings.filter((x) => x.projectId === p.id);
    if (!pf.length) continue;
    L.push(`## ${p.reference} – ${p.name}`, "");
    for (const x of pf) L.push(`- ${SEV[x.severity]} ${x.title} ➜ ${x.recommendation} (${x.responsible})`);
    L.push("");
  }
  return { title: "MADIBU – RAPPORT HEBDOMADAIRE DES CHANTIERS", markdown: L.join("\n") };
}

export function paymentReminder(params: { level: 1 | 2 | 3; number: string; issueDate: string; dueDate: string; open: Cents; daysOverdue: number; projectName?: string | null; company: string }) {
  const { level, number } = params;
  const subject = level === 1 ? `Rappel – facture ${number}` : level === 2 ? `Second rappel – facture ${number}` : `Dernier rappel avant mise en demeure – facture ${number}`;
  const intro = level === 1
    ? "Sauf erreur de notre part, nous n'avons pas encore reçu le paiement de la facture ci-dessous."
    : level === 2 ? "Malgré notre précédent rappel, la facture ci-dessous reste impayée à ce jour."
    : "La facture ci-dessous reste impayée malgré nos rappels. Sans règlement dans les 8 jours, nous serons contraints d'appliquer les dispositions prévues par nos conditions générales.";
  const body = [
    "Madame, Monsieur,", "", intro, "",
    `• Facture : ${number} du ${formatDate(params.issueDate)}`,
    `• Chantier : ${params.projectName ?? "—"}`,
    `• Échéance : ${formatDate(params.dueDate)} (${params.daysOverdue} jours de retard)`,
    `• Solde dû : ${formatEur(params.open)}`, "",
    "Si le paiement a été effectué entre-temps, merci de ne pas tenir compte de ce message et de nous transmettre la preuve de paiement.", "",
    "Bien cordialement,", "", `L'administration – ${params.company}`,
  ].join("\n");
  return { subject, body };
}
