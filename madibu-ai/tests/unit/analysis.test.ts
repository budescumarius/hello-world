import { describe, expect, it } from "vitest";
import { runAllAgents } from "@/lib/domain/analysis";
import { dailyFinancialReport, DAILY_FINANCIAL_TITLE, paymentReminder } from "@/lib/domain/reports";
import { emptyData, issued, obligation, payment, project, received } from "./fixtures";

const TODAY = "2026-11-01";
const keys = (fs: { key: string }[]) => fs.map((f) => f.key.split(":")[0]);

function scenario() {
  const d = emptyData();
  d.clients.push({ id: "cli-1", name: "ACP Les Tilleuls", email: "syndic@example.test", kind: "client" });
  d.subcontractors.push({ id: "sub-1", name: "Étanchéité Démo", email: null, kind: "subcontractor", insurance_valid_until: "2026-10-15" });
  d.bankBalances.push({ account_label: "Courant", balance: 3_000_000, as_of: "2026-10-31", source: "manual" });
  // Chantier toiture : coûts > budget, en retard, en perte
  const roof = project({ reference: "MAD-2026-011", contract_amount_excl: 13_650_000, progress_pct: 85, planned_end_date: "2026-10-12",
    budget_materials: 4_600_000, budget_labour: 3_100_000, budget_subcontract: 2_800_000, budget_other: 450_000 });
  d.projects.push(roof);
  d.invoices.push(received({ project_id: roof.id, amount_excl: 12_950_000, due_date: "2026-11-25" }));
  const late = issued({ project_id: roof.id, amount_excl: 5_460_000, kind: "advance", due_date: "2026-08-18" });
  d.invoices.push(late);
  // dette sous-traitant échue de 35 j
  d.invoices.push(received({ project_id: roof.id, amount_excl: 1_380_000, subcontractor_id: "sub-1", supplier_id: null, cost_category: "subcontract", vat_amount: 0, due_date: "2026-09-27" }));
  d.obligations.push(obligation({ amount: 4_150_000, label: "Salaires", next_due_date: "2026-11-28" }));
  d.changeOrders.push({ id: "co-1", project_id: roof.id, description: "Chevrons", amount_excl: 940_000, status: "requested", work_started: true, requested_on: "2026-10-02" });
  return { d, roof, late };
}

describe("Agents d'analyse – scénario de chantier en difficulté", () => {
  it("détecte les risques financiers et opérationnels attendus", () => {
    const { d } = scenario();
    const k = keys(runAllAgents(d, TODAY));
    expect(k).toEqual(expect.arrayContaining([
      "receivable_overdue", "payable_overdue", "margin_low", "budget_overrun", "project_late",
      "change_order_unapproved", "cash_shortage", "subcontractor_insurance", "missing_contract_doc",
    ]));
  });

  it("chaque constat dit quoi, pourquoi, que faire, qui", () => {
    const { d } = scenario();
    for (const f of runAllAgents(d, TODAY)) {
      expect(f.title.length).toBeGreaterThan(5);
      expect(f.why.length).toBeGreaterThan(5);
      expect(f.recommendation.length).toBeGreaterThan(5);
      expect(f.responsible.length).toBeGreaterThan(2);
    }
  });

  it("classe la créance de 75 jours en critique et prépare un rappel de niveau 3", () => {
    const { d, late } = scenario();
    const f = runAllAgents(d, TODAY).find((x) => x.key === `receivable_overdue:${late.id}`)!;
    expect(f.severity).toBe("critical");
    expect(f.reminder).toEqual({ invoiceId: late.id, level: 3 });
    expect(f.impactAmount).toBe(late.amount_total);
  });

  it("ne suppose jamais un paiement : une facture réglée disparaît uniquement après enregistrement", () => {
    const { d, late } = scenario();
    expect(keys(runAllAgents(d, TODAY))).toContain("receivable_overdue");
    d.payments.push(payment({ invoice_id: late.id, amount: late.amount_total }));
    expect(runAllAgents(d, TODAY).some((f) => f.key === `receivable_overdue:${late.id}`)).toBe(false);
  });

  it("signale l'absence de solde bancaire plutôt que de l'estimer", () => {
    const { d } = scenario();
    d.bankBalances = [];
    const fs = runAllAgents(d, TODAY);
    expect(fs.some((f) => f.key === "bank_balance_missing")).toBe(true);
    expect(fs.some((f) => f.key.startsWith("cash_shortage"))).toBe(false);
  });

  it("liste précisément les données manquantes", () => {
    const d = emptyData();
    d.projects.push(project({ contract_amount_excl: null, budget_materials: null, budget_labour: null, budget_subcontract: null, budget_other: null }));
    const f = runAllAgents(d, TODAY).find((x) => x.key.startsWith("missing_data"))!;
    expect(f.why).toContain("montant du contrat HTVA");
    expect(f.why).toContain("budget par poste");
  });
});

describe("Rapport financier quotidien", () => {
  it("porte le titre exigé et les 7 sections", () => {
    const { d } = scenario();
    const r = dailyFinancialReport(d, runAllAgents(d, TODAY), TODAY);
    expect(r.title).toBe(DAILY_FINANCIAL_TITLE);
    expect(r.markdown.startsWith("# MADIBU – DAILY FINANCIAL REPORT")).toBe(true);
    for (const s of ["## 1.", "## 2.", "## 3.", "## 4.", "## 5.", "## 6.", "## 7."]) expect(r.markdown).toContain(s);
    expect(r.markdown).toContain("saisie manuelle");
  });

  it("rédige des rappels progressifs en français", () => {
    const r = paymentReminder({ level: 2, number: "F2026-0179", issueDate: "2026-07-19", dueDate: "2026-08-18", open: 5_787_600, daysOverdue: 75, company: "MADIBU GROUP" });
    expect(r.subject).toBe("Second rappel – facture F2026-0179");
    expect(r.body).toContain("57");
    expect(r.body).toContain("Madame, Monsieur");
  });
});
