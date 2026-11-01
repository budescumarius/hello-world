/**
 * Agents d'analyse – règles métier déterministes, fonctions pures.
 *
 * Chaque constat répond aux questions du « COO virtuel » :
 *   que s'est-il passé (title) · pourquoi c'est important (why) · impact chiffré (impactAmount)
 *   · que faire (recommendation) · qui (responsible) · pour quand (dueDate).
 * Les règles n'inventent aucune donnée : un indicateur non calculable produit un constat
 * « données manquantes » qui précise exactement ce qu'il faut compléter.
 */
import { addDays, daysBetween } from "../dates";
import { type Cents, formatEur, formatPct, sum } from "../money";
import {
  allForecasts, bankPosition, HORIZONS, isActive, payables, projectFinancials, receivables,
  type ProjectFinancials, type Scenario,
} from "./finance";
import type { CompanyData, Project } from "./types";

export type Severity = "info" | "warning" | "high" | "critical";
export type Agent = "financial_controller" | "project_manager" | "admin_assistant" | "site_supervisor" | "procurement";

export interface Finding {
  key: string;
  agent: Agent;
  category: "finance" | "project" | "admin" | "supplier" | "site" | "data";
  severity: Severity;
  title: string;
  why: string;
  impactAmount: Cents | null;
  recommendation: string;
  responsible: string;
  dueDate: string | null;
  projectId: string | null;
  entityTable: string | null;
  entityId: string | null;
  createTask: boolean;
  taskPriority: "low" | "normal" | "high" | "urgent";
  reminder?: { invoiceId: string; level: 1 | 2 | 3 };
}

export interface AnalysisSettings {
  cashAlertThreshold: Cents;   // seuil de trésorerie minimale
  minMarginPct: number;        // marge minimale acceptable
  progressStaleDays: number;
  deadlineWarningDays: number;
}
export const DEFAULT_SETTINGS: AnalysisSettings = {
  cashAlertThreshold: 2_000_000, minMarginPct: 10, progressStaleDays: 14, deadlineWarningDays: 14,
};

export const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, warning: 2, info: 3 };
export const MISSING_LABELS: Record<string, string> = {
  contract_amount: "montant du contrat HTVA", budget: "budget par poste", progress: "avancement (%)",
  planned_end_date: "date de fin prévue", client: "client",
};
const eur = (c: Cents | null) => formatEur(c, { digits: 0 });
export const METHOD_LABELS: Record<string, string> = { manual: "prévision manuelle", trend: "tendance coûts ÷ avancement", actual: "coûts réels", budget: "budget" };

function f(partial: Omit<Finding, "impactAmount" | "dueDate" | "projectId" | "entityTable" | "entityId" | "createTask" | "taskPriority"> & Partial<Finding>): Finding {
  return { impactAmount: null, dueDate: null, projectId: null, entityTable: null, entityId: null, createTask: false, taskPriority: "normal", ...partial };
}

// ----------------------------------------------------------------------------- contrôleur financier
export function financialControllerFindings(data: CompanyData, today: string, s: AnalysisSettings): Finding[] {
  const out: Finding[] = [];
  const clients = new Map(data.clients.map((c) => [c.id, c]));
  const projects = new Map(data.projects.map((p) => [p.id, p]));
  const partyName = (id: string | null) =>
    (id && (clients.get(id)?.name ?? data.suppliers.find((x) => x.id === id)?.name ?? data.subcontractors.find((x) => x.id === id)?.name)) || "tiers inconnu";

  // 1. Créances en retard
  for (const r of receivables(data, today)) {
    if (r.daysOverdue <= 0) continue;
    const d = r.daysOverdue;
    const level: 1 | 2 | 3 = d <= 14 ? 1 : d <= 45 ? 2 : 3;
    const proj = r.project_id ? projects.get(r.project_id) : undefined;
    out.push(f({
      key: `receivable_overdue:${r.id}`, agent: "financial_controller", category: "finance",
      severity: d > 60 ? "critical" : d > 30 ? "high" : "warning",
      title: `Facture ${r.number} impayée depuis ${d} j – ${partyName(r.party_id)}`,
      why: `Solde ouvert ${formatEur(r.open)} TVAC sur ${formatEur(r.total)}${r.paid ? ` (déjà encaissé ${formatEur(r.paid)})` : ""}, échéance ${r.due_date}${proj ? `, chantier ${proj.reference}` : ""}. Cet argent finance actuellement le client.`,
      impactAmount: r.open,
      recommendation: level === 1 ? "Envoyer le rappel préparé (approbation requise)."
        : level === 2 ? "Envoyer le 2e rappel préparé et appeler le client aujourd'hui."
        : "Appeler le client, envoyer le dernier rappel ; décider d'une mise en demeure et de la suspension des travaux.",
      responsible: "Administrateur / Finance", dueDate: today, projectId: r.project_id,
      entityTable: "invoices", entityId: r.id, createTask: d > 7, taskPriority: d > 60 ? "urgent" : "high",
      reminder: d > 7 && !r.disputed ? { invoiceId: r.id, level } : undefined,
    }));
  }

  // 2. Dettes échues / contestées
  for (const p of payables(data, today)) {
    const isSub = data.subcontractors.some((x) => x.id === p.party_id);
    if (p.disputed) {
      out.push(f({
        key: `payable_disputed:${p.id}`, agent: "procurement", category: "supplier", severity: "warning",
        title: `Facture contestée : ${partyName(p.party_id)} n° ${p.number}`,
        why: `${formatEur(p.open)} TVAC en litige. Elle ne doit pas être payée avant résolution.`,
        impactAmount: p.open, recommendation: "Documenter le litige par écrit et obtenir une note de crédit ou une justification.",
        responsible: "Chef de projet", dueDate: addDays(today, 7), projectId: p.project_id, entityTable: "invoices", entityId: p.id,
        createTask: true,
      }));
    } else if (p.daysOverdue > 0) {
      out.push(f({
        key: `payable_overdue:${p.id}`, agent: "financial_controller", category: "finance",
        severity: p.daysOverdue > 30 || (isSub && p.daysOverdue > 14) ? "high" : "warning",
        title: `${isSub ? "Sous-traitant" : "Fournisseur"} à payer : ${partyName(p.party_id)} n° ${p.number} (${p.daysOverdue} j de retard)`,
        why: isSub ? "Un sous-traitant impayé peut quitter le chantier ou réclamer des intérêts : risque de retard."
          : "Un fournisseur impayé peut bloquer les livraisons ou facturer des intérêts de retard.",
        impactAmount: p.open, recommendation: "Planifier le paiement (approbation requise) ou négocier un échéancier par écrit.",
        responsible: "Finance", dueDate: addDays(today, 3), projectId: p.project_id, entityTable: p.type === "invoice" ? "invoices" : "expenses",
        entityId: p.id, createTask: p.daysOverdue > 14, taskPriority: "high",
      }));
    }
  }

  // 3. Trésorerie : solde, prévisions 7/30/90 j par scénario
  const bank = bankPosition(data.bankBalances, today);
  if (!bank.known) {
    out.push(f({
      key: "bank_balance_missing", agent: "financial_controller", category: "data", severity: "high",
      title: "Aucun solde bancaire saisi",
      why: "Sans solde de départ, la trésorerie disponible et les prévisions de solde ne peuvent pas être calculées.",
      recommendation: "Saisir le solde de chaque compte bancaire (Finances → Banque).", responsible: "Finance", dueDate: today, createTask: true, taskPriority: "high",
    }));
  } else if ((bank.ageDays ?? 0) > 7) {
    out.push(f({
      key: "bank_balance_stale", agent: "financial_controller", category: "data", severity: "warning",
      title: `Solde bancaire non actualisé depuis ${bank.ageDays} j`,
      why: `Le solde utilisé (${eur(bank.balance)} au ${bank.asOf}) peut ne plus refléter la réalité.`,
      recommendation: "Mettre à jour les soldes bancaires.", responsible: "Finance", dueDate: today, createTask: true,
    }));
  }
  if (bank.known) {
    const fc = allForecasts(data, today);
    const worst = (["realistic", "pessimistic"] as Scenario[]).flatMap((sc) =>
      HORIZONS.map((h) => ({ sc, h, ...fc[sc].horizons[h] })));
    const shortage = worst.find((w) => w.minBalance !== null && w.minBalance < 0);
    const tight = worst.find((w) => w.minBalance !== null && w.minBalance < s.cashAlertThreshold);
    const hit = shortage ?? tight;
    if (hit) {
      const label = hit.sc === "realistic" ? "réaliste" : "pessimiste";
      out.push(f({
        key: `cash_shortage:${hit.minBalance! < 0 ? "negative" : "low"}`, agent: "financial_controller", category: "finance",
        severity: hit.minBalance! < 0 ? (hit.sc === "realistic" || hit.h <= 30 ? "critical" : "high") : "high",
        title: `${hit.minBalance! < 0 ? "Manque de trésorerie" : "Trésorerie sous le seuil"} prévu dans ${hit.h} j (scénario ${label}) : point bas ${eur(hit.minBalance)} le ${hit.minDate}`,
        why: `Seuil de sécurité ${eur(s.cashAlertThreshold)}. Créances exclues de ce scénario (retards importants/litiges) : ${eur(fc[hit.sc].excludedReceivables)}.`,
        impactAmount: hit.minBalance! < 0 ? -hit.minBalance! : s.cashAlertThreshold - hit.minBalance!,
        recommendation: "Accélérer le recouvrement des factures en retard, émettre les états d'avancement non facturés, reporter les dépenses non urgentes, prévenir la banque si nécessaire.",
        responsible: "Administrateur", dueDate: today, createTask: true, taskPriority: "urgent",
      }));
    }
  }

  // 4. Obligations non actualisées (paiement non confirmé)
  for (const o of data.obligations.filter((x) => x.active && x.next_due_date < today)) {
    out.push(f({
      key: `obligation_unconfirmed:${o.id}`, agent: "financial_controller", category: "data", severity: "warning",
      title: `Échéance non confirmée : ${o.label} (${o.next_due_date})`,
      why: `${eur(o.amount)} prévus. Le paiement n'est pas confirmé dans le système : il n'est pas supposé effectué.`,
      impactAmount: o.amount, recommendation: "Vérifier le relevé bancaire, enregistrer le paiement et confirmer l'échéance.",
      responsible: "Finance", dueDate: today, entityTable: "recurring_obligations", entityId: o.id, createTask: true,
    }));
  }

  // 5. Rentabilité, budget, avances par chantier
  for (const p of data.projects.filter(isActive)) {
    const fin = projectFinancials(p, data, today);
    out.push(...projectFinanceFindings(p, fin, s));
  }
  return out;
}

function projectFinanceFindings(p: Project, fin: ProjectFinancials, s: AnalysisSettings): Finding[] {
  const out: Finding[] = [];
  const label = `${p.reference} ${p.name}`;
  const base = { projectId: p.id, entityTable: "projects", entityId: p.id };
  if (fin.estimatedMarginPct !== null && fin.estimatedMarginPct < s.minMarginPct) {
    const worst = (["materials", "labour", "subcontract", "other"] as const)
      .map((k) => ({ k, budget: { materials: p.budget_materials, labour: p.budget_labour, subcontract: p.budget_subcontract, other: p.budget_other }[k], actual: fin.costs[k] }))
      .filter((x) => x.budget !== null && x.actual > x.budget!)
      .sort((a, b) => (b.actual - b.budget!) - (a.actual - a.budget!))[0];
    const source = worst ? ` Principal dépassement : ${{ materials: "matériaux", labour: "main-d'œuvre", subcontract: "sous-traitance", other: "autres" }[worst.k]} (+${eur(worst.actual - worst.budget!)}).` : "";
    out.push(f({
      key: `margin_low:${p.id}`, agent: "financial_controller", category: "finance",
      severity: fin.estimatedMarginPct < 0 ? "critical" : "high",
      title: fin.estimatedMarginPct < 0 ? `Chantier en perte : ${label} (marge estimée ${formatPct(fin.estimatedMarginPct)})` : `Marge insuffisante : ${label} (${formatPct(fin.estimatedMarginPct)})`,
      why: `Coût final estimé ${eur(fin.forecastFinalCost)} (méthode : ${METHOD_LABELS[fin.forecastMethod ?? ""] ?? "—"}) pour un contrat de ${eur(fin.totalContractExcl)} HTVA.${source}`,
      impactAmount: fin.estimatedProfit !== null && fin.estimatedProfit < 0 ? -fin.estimatedProfit : null,
      recommendation: "Analyser les postes en dépassement, chiffrer les travaux supplémentaires facturables (avenants), revoir les achats restants.",
      responsible: "Chef de projet", dueDate: null, createTask: fin.estimatedMarginPct < 0, taskPriority: "urgent", ...base,
    }));
  }
  if (fin.budgetTotal !== null && fin.costsIncurred > fin.budgetTotal) {
    out.push(f({
      key: `budget_overrun:${p.id}`, agent: "financial_controller", category: "finance", severity: "high",
      title: `Coûts au-delà du budget approuvé : ${label}`,
      why: `Coûts engagés ${eur(fin.costsIncurred)} HTVA pour un budget de ${eur(fin.budgetTotal)} (avancement ${formatPct(fin.progressPct)}).`,
      impactAmount: fin.costsIncurred - fin.budgetTotal,
      recommendation: "Identifier les postes en dépassement et vérifier s'ils relèvent d'avenants à faire signer.",
      responsible: "Chef de projet", createTask: true, taskPriority: "high", ...base,
    }));
  }
  if (p.status === "in_progress" && fin.totalContractExcl && !fin.hasAdvanceInvoice && fin.invoicedExcl < fin.totalContractExcl * 0.1) {
    out.push(f({
      key: `no_advance:${p.id}`, agent: "financial_controller", category: "finance", severity: "warning",
      title: `Aucun acompte facturé : ${label}`,
      why: `Le chantier a démarré sans acompte ; MADIBU préfinance les travaux. Coûts payés à ce jour : ${eur(fin.costsPaid)}.`,
      recommendation: "Émettre une facture d'acompte conforme au contrat (approbation requise).",
      responsible: "Finance", createTask: true, taskPriority: "high", ...base,
    }));
  }
  if (fin.totalContractExcl && fin.cashPosition < -0.1 * fin.totalContractExcl) {
    out.push(f({
      key: `project_cash_negative:${p.id}`, agent: "financial_controller", category: "finance", severity: "high",
      title: `Chantier préfinancé par MADIBU : ${label}`,
      why: `Encaissé ${eur(fin.collected)} TVAC contre ${eur(fin.costsPaid)} payés : position de trésorerie du chantier ${eur(fin.cashPosition)}.`,
      impactAmount: -fin.cashPosition,
      recommendation: "Facturer l'avancement réel et relancer les paiements avant d'engager de nouveaux achats.",
      responsible: "Finance", ...base,
    }));
  }
  if (fin.unbilledWork !== null && fin.totalContractExcl && fin.unbilledWork > 0.1 * fin.totalContractExcl) {
    out.push(f({
      key: `unbilled:${p.id}`, agent: "project_manager", category: "project", severity: "warning",
      title: `Travaux réalisés non facturés : ${eur(fin.unbilledWork)} – ${label}`,
      why: `Avancement déclaré ${formatPct(fin.progressPct)} ⇒ valeur réalisée ${eur(fin.earnedValue)} HTVA ; facturé ${eur(fin.invoicedExcl)}. (L'avancement déclaré n'est pas une réception : à vérifier sur chantier.)`,
      impactAmount: fin.unbilledWork,
      recommendation: "Vérifier l'avancement sur place puis préparer l'état d'avancement (émission soumise à approbation).",
      responsible: "Chef de projet", dueDate: null, createTask: true, taskPriority: "high", ...base,
    }));
  }
  if (fin.missing.length) {
    out.push(f({
      key: `missing_data:${p.id}`, agent: "admin_assistant", category: "data", severity: "warning",
      title: `Données manquantes : ${label}`,
      why: "Indicateurs non calculés faute de données : " + fin.missing.map((m) => MISSING_LABELS[m] ?? m).join(", ") + ".",
      recommendation: "Compléter la fiche chantier : " + fin.missing.map((m) => MISSING_LABELS[m] ?? m).join(", ") + ".",
      responsible: "Chef de projet", createTask: true, ...base,
    }));
  }
  return out;
}

// ----------------------------------------------------------------------------- chef de projet
export function projectManagerFindings(data: CompanyData, today: string, s: AnalysisSettings): Finding[] {
  const out: Finding[] = [];
  for (const p of data.projects.filter((x) => !x.archived_at)) {
    const fin = projectFinancials(p, data, today);
    const label = `${p.reference} ${p.name}`;
    const base = { projectId: p.id, entityTable: "projects", entityId: p.id };
    const active = isActive(p);
    const docs = data.documents.filter((d) => d.project_id === p.id);

    if (active && fin.daysLate) {
      out.push(f({
        key: `project_late:${p.id}`, agent: "project_manager", category: "project", severity: fin.daysLate > 14 ? "high" : "warning",
        title: `Chantier en retard de ${fin.daysLate} j : ${label}`,
        why: `Fin prévue le ${p.planned_end_date}, avancement déclaré ${formatPct(fin.progressPct)}. Risque de pénalités et d'insatisfaction client.`,
        recommendation: "Établir un planning de rattrapage, fixer une nouvelle date réaliste et informer le client (e-mail à approuver).",
        responsible: "Chef de projet", dueDate: addDays(today, 2), createTask: fin.daysLate > 14, taskPriority: "high", ...base,
      }));
    } else if (active && p.planned_end_date && daysBetween(today, p.planned_end_date) <= s.deadlineWarningDays && (fin.progressPct ?? 0) < 90) {
      out.push(f({
        key: `deadline_soon:${p.id}`, agent: "project_manager", category: "project", severity: "warning",
        title: `Échéance dans ${daysBetween(today, p.planned_end_date)} j : ${label}`,
        why: `Avancement déclaré ${formatPct(fin.progressPct)} à moins de ${s.deadlineWarningDays} jours de la fin prévue.`,
        recommendation: "Confirmer la date avec le chef de chantier et préparer la réception.",
        responsible: "Chef de projet", dueDate: p.planned_end_date, ...base,
      }));
    }
    if (p.status === "in_progress" && fin.progressPct !== null && fin.plannedProgressPct !== null && fin.plannedProgressPct - fin.progressPct >= 15) {
      out.push(f({
        key: `behind_schedule:${p.id}`, agent: "project_manager", category: "project", severity: "warning",
        title: `Avancement en retard sur le planning : ${label}`,
        why: `Avancement déclaré ${formatPct(fin.progressPct)} contre ${formatPct(fin.plannedProgressPct)} attendu (estimation linéaire entre début et fin prévue).`,
        recommendation: "Vérifier les effectifs affectés et les livraisons en attente.", responsible: "Chef de projet", ...base,
      }));
    }
    if (active && p.progress_updated_at && daysBetween(p.progress_updated_at.slice(0, 10), today) > s.progressStaleDays) {
      out.push(f({
        key: `progress_stale:${p.id}`, agent: "site_supervisor", category: "site", severity: "info",
        title: `Avancement non mis à jour depuis ${daysBetween(p.progress_updated_at.slice(0, 10), today)} j : ${label}`,
        why: "Les indicateurs de facturation et de rentabilité reposent sur l'avancement déclaré.",
        recommendation: "Demander au chef de chantier de mettre à jour l'avancement.", responsible: "Chef de chantier", ...base,
      }));
    }
    if ((p.status === "signed" || p.status === "in_progress") && !docs.some((d) => d.category === "contract")) {
      out.push(f({
        key: `missing_contract_doc:${p.id}`, agent: "admin_assistant", category: "admin", severity: "warning",
        title: `Contrat signé absent du dossier : ${label}`,
        why: "Sans contrat archivé, les montants, délais et conditions de paiement ne sont pas opposables.",
        recommendation: "Téléverser le contrat signé (Documents, catégorie « Contrat »).", responsible: "Administrateur", createTask: true, ...base,
      }));
    }
    if (p.status === "completed" && !docs.some((d) => d.category === "handover")) {
      out.push(f({
        key: `missing_handover:${p.id}`, agent: "project_manager", category: "project", severity: "warning",
        title: `Réception non documentée : ${label}`,
        why: "Travaux terminés sans procès-verbal de réception : garanties et solde final exposés.",
        recommendation: "Organiser la réception avec le client et l'architecte, archiver le PV.", responsible: "Chef de projet", createTask: true, ...base,
      }));
    }
  }

  for (const co of data.changeOrders.filter((c) => c.status === "requested" || c.status === "quoted")) {
    const p = data.projects.find((x) => x.id === co.project_id);
    const age = daysBetween(co.requested_on, today);
    if (co.work_started || age > 14) {
      out.push(f({
        key: `change_order_unapproved:${co.id}`, agent: "project_manager", category: "project",
        severity: co.work_started ? "high" : "warning",
        title: `${co.work_started ? "Travaux supplémentaires exécutés sans accord écrit" : "Avenant en attente d'accord"} : ${p?.reference ?? ""} – ${co.description}`,
        why: `${co.amount_excl === null ? "Montant non chiffré" : eur(co.amount_excl) + " HTVA"}, demandé le ${co.requested_on}. Sans accord écrit du client, ces travaux risquent de ne pas être payés.`,
        impactAmount: co.amount_excl, recommendation: "Faire signer l'avenant par le client avant de poursuivre ces travaux.",
        responsible: "Chef de projet", dueDate: addDays(today, 3), projectId: co.project_id, entityTable: "change_orders", entityId: co.id,
        createTask: true, taskPriority: co.work_started ? "urgent" : "normal",
      }));
    }
  }

  const overdueTasks = data.tasks.filter((t) => t.due_date && t.due_date < today && ["todo", "in_progress", "waiting"].includes(t.status));
  if (overdueTasks.length) {
    out.push(f({
      key: "tasks_overdue", agent: "admin_assistant", category: "admin", severity: overdueTasks.some((t) => t.priority === "urgent") ? "high" : "warning",
      title: `${overdueTasks.length} tâche(s) en retard`,
      why: overdueTasks.slice(0, 5).map((t) => `${t.title} (${t.due_date})`).join(" ; "),
      recommendation: "Réaffecter ou replanifier les tâches en retard.", responsible: "Administrateur",
    }));
  }
  return out;
}

// ----------------------------------------------------------------------------- administration / sous-traitants
export function adminFindings(data: CompanyData, today: string): Finding[] {
  const out: Finding[] = [];
  const orphan = data.invoices.filter((i) => i.direction === "received" && !i.project_id && i.status !== "cancelled" && i.cost_category !== "overhead");
  if (orphan.length) {
    out.push(f({
      key: "received_invoices_without_project", agent: "admin_assistant", category: "data", severity: "warning",
      title: `${orphan.length} facture(s) d'achat sans chantier`,
      why: `Coûts non imputés (${eur(sum(orphan.map((i) => i.amount_excl)))} HTVA) : la rentabilité des chantiers est sous-estimée.`,
      recommendation: "Affecter chaque facture à son chantier ou la classer en frais généraux.", responsible: "Finance", createTask: true,
    }));
  }
  const overdueClientIds = new Set(receivables(data, today).filter((r) => r.daysOverdue > 0).map((r) => r.party_id));
  for (const c of data.clients.filter((x) => overdueClientIds.has(x.id) && !x.email)) {
    out.push(f({
      key: `client_no_email:${c.id}`, agent: "admin_assistant", category: "data", severity: "warning",
      title: `Client sans e-mail avec factures en retard : ${c.name}`,
      why: "Les rappels de paiement ne peuvent pas être préparés pour envoi.",
      recommendation: "Compléter l'adresse e-mail du client.", responsible: "Administrateur", entityTable: "clients", entityId: c.id, createTask: true,
    }));
  }
  for (const sc of data.subcontractors) {
    if (!sc.insurance_valid_until) continue;
    const left = daysBetween(today, sc.insurance_valid_until);
    if (left <= 30) {
      out.push(f({
        key: `subcontractor_insurance:${sc.id}`, agent: "procurement", category: "supplier", severity: left < 0 ? "high" : "warning",
        title: left < 0 ? `Assurance expirée : ${sc.name}` : `Assurance expire dans ${left} j : ${sc.name}`,
        why: "Un sous-traitant non assuré expose MADIBU en cas de sinistre sur chantier.",
        recommendation: "Demander l'attestation d'assurance à jour avant toute nouvelle intervention.", responsible: "Chef de projet",
        dueDate: left < 0 ? today : sc.insurance_valid_until, entityTable: "subcontractors", entityId: sc.id, createTask: left < 0,
      }));
    }
  }
  return out;
}

export function runAllAgents(data: CompanyData, today: string, s: AnalysisSettings = DEFAULT_SETTINGS): Finding[] {
  const all = [...financialControllerFindings(data, today, s), ...projectManagerFindings(data, today, s), ...adminFindings(data, today)];
  const seen = new Set<string>();
  return all
    .filter((x) => (seen.has(x.key) ? false : (seen.add(x.key), true)))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (b.impactAmount ?? 0) - (a.impactAmount ?? 0));
}
