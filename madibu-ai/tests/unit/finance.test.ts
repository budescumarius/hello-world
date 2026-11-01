import { describe, expect, it } from "vitest";
import {
  aging, allForecasts, bankPosition, companySummary, expectedCollectionDate, obligationOccurrences, payables,
  projectFinancials, receivables,
} from "@/lib/domain/finance";
import { emptyData, expense, issued, obligation, payment, project, received } from "./fixtures";

const TODAY = "2026-11-01";

describe("Fiche financière d'un chantier", () => {
  it("distingue facturé et encaissé, coût engagé et coût payé", () => {
    const d = emptyData();
    const p = project({ contract_amount_excl: 20_000_000, progress_pct: 40 });
    const inv = issued({ project_id: p.id, amount_excl: 5_000_000, kind: "advance" }); // 53 000 € TVAC
    const pinv = received({ project_id: p.id, amount_excl: 2_000_000 });            // 24 200 € TVAC
    d.projects.push(p);
    d.invoices.push(inv, pinv);
    d.payments.push(payment({ invoice_id: inv.id, amount: 3_000_000 }), payment({ direction: "out", invoice_id: pinv.id, amount: 1_000_000 }));
    d.expenses.push(expense({ project_id: p.id, amount_excl: 1_500_000 }));

    const f = projectFinancials(p, d, TODAY);
    expect(f.invoicedExcl).toBe(5_000_000);
    expect(f.invoicedTotal).toBe(5_300_000);
    expect(f.collected).toBe(3_000_000);          // seul le paiement enregistré compte
    expect(f.outstandingReceivable).toBe(2_300_000);
    expect(f.costsIncurred).toBe(3_500_000);      // facture reçue + main-d'œuvre
    expect(f.costs.materials).toBe(2_000_000);
    expect(f.costs.labour).toBe(1_500_000);
    expect(f.costsPaid).toBe(1_000_000);          // payé ≠ engagé
    expect(f.unpaidCommitments).toBe(1_420_000);  // 24 200 - 10 000 € (la paie est exclue)
    expect(f.payrollLabour).toBe(1_500_000);
    expect(f.hasAdvanceInvoice).toBe(true);
  });

  it("estime le coût final par tendance et calcule la marge", () => {
    const d = emptyData();
    const p = project({ contract_amount_excl: 13_650_000, progress_pct: 85 });
    d.projects.push(p);
    d.invoices.push(received({ project_id: p.id, amount_excl: 12_950_000 }));
    const f = projectFinancials(p, d, TODAY);
    expect(f.forecastMethod).toBe("trend");
    expect(f.forecastFinalCost).toBe(15_235_294); // 129 500 / 0,85
    expect(f.estimatedProfit).toBe(13_650_000 - 15_235_294);
    expect(f.estimatedMarginPct!).toBeLessThan(0);
  });

  it("n'invente aucune donnée manquante", () => {
    const d = emptyData();
    const p = project({ contract_amount_excl: null, budget_materials: null, budget_labour: null, budget_subcontract: null, budget_other: null, progress_pct: null, planned_end_date: null });
    d.projects.push(p);
    const f = projectFinancials(p, d, TODAY);
    expect(f.totalContractExcl).toBeNull();
    expect(f.budgetTotal).toBeNull();
    expect(f.forecastFinalCost).toBeNull();
    expect(f.estimatedProfit).toBeNull();
    expect(f.estimatedMarginPct).toBeNull();
    expect(f.missing).toEqual(expect.arrayContaining(["contract_amount", "budget", "progress", "planned_end_date"]));
  });

  it("intègre les avenants approuvés uniquement et déduit les notes de crédit", () => {
    const d = emptyData();
    const p = project({ contract_amount_excl: 10_000_000 });
    d.projects.push(p);
    d.changeOrders.push(
      { id: "co1", project_id: p.id, description: "Velux", amount_excl: 500_000, status: "approved", work_started: true, requested_on: "2026-09-01" },
      { id: "co2", project_id: p.id, description: "Terrasse", amount_excl: 900_000, status: "requested", work_started: false, requested_on: "2026-10-20" },
    );
    d.invoices.push(issued({ project_id: p.id, amount_excl: 4_000_000 }), issued({ project_id: p.id, amount_excl: 500_000, kind: "credit_note" }));
    const f = projectFinancials(p, d, TODAY);
    expect(f.totalContractExcl).toBe(10_500_000);
    expect(f.pendingChangeOrders).toBe(900_000);
    expect(f.invoicedExcl).toBe(3_500_000);
  });

  it("ignore les factures brouillon et annulées", () => {
    const d = emptyData();
    const p = project();
    d.projects.push(p);
    d.invoices.push(issued({ project_id: p.id, amount_excl: 1_000_000, status: "draft" }), issued({ project_id: p.id, amount_excl: 1_000_000, status: "cancelled" }));
    expect(projectFinancials(p, d, TODAY).invoicedExcl).toBe(0);
  });
});

describe("Créances, dettes et balance âgée", () => {
  it("ne considère une facture payée que si les paiements couvrent le total", () => {
    const d = emptyData();
    const a = issued({ amount_excl: 1_000_000, due_date: "2026-08-18" }); // 75 j de retard
    const b = issued({ amount_excl: 1_000_000, due_date: "2026-11-20" });
    const c = issued({ amount_excl: 1_000_000, due_date: "2026-10-01" });
    d.invoices.push(a, b, c);
    d.payments.push(payment({ invoice_id: c.id, amount: c.amount_total }), payment({ invoice_id: a.id, amount: 100_000 }));
    const rec = receivables(d, TODAY);
    expect(rec.map((r) => r.id)).toEqual([a.id, b.id]);
    expect(rec[0].open).toBe(a.amount_total - 100_000);
    expect(rec[0].daysOverdue).toBe(75);
    const ag = aging(rec);
    expect(ag.d61_90).toBe(a.amount_total - 100_000);
    expect(ag.not_due).toBe(b.amount_total);
  });

  it("compte les dépenses payables non réglées, pas la main-d'œuvre interne", () => {
    const d = emptyData();
    d.expenses.push(expense({ amount_excl: 50_000, settlement: "payable", category: "transport" }), expense({ amount_excl: 900_000 }));
    expect(payables(d, TODAY).map((p) => p.open)).toEqual([50_000]);
  });
});

describe("Obligations et banque", () => {
  it("déroule les échéances mensuelles et respecte la date de fin", () => {
    const occ = obligationOccurrences([obligation({ amount: 245_000, next_due_date: "2026-11-05", end_date: "2027-01-31" })], TODAY, "2027-03-01");
    expect(occ.map((o) => o.date)).toEqual(["2026-11-05", "2026-12-05", "2027-01-05"]);
  });

  it("gère les fins de mois", () => {
    const occ = obligationOccurrences([obligation({ amount: 1, next_due_date: "2027-01-31" })], "2027-01-01", "2027-04-30");
    expect(occ.map((o) => o.date)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
  });

  it("prend le dernier solde par compte et signale l'ancienneté", () => {
    const pos = bankPosition([
      { account_label: "A", balance: 100, as_of: "2026-10-01", source: "manual" },
      { account_label: "A", balance: 300, as_of: "2026-10-20", source: "manual" },
      { account_label: "B", balance: 50, as_of: "2026-10-25", source: "manual" },
    ], TODAY);
    expect(pos.balance).toBe(350);
    expect(pos.asOf).toBe("2026-10-20");
    expect(pos.ageDays).toBe(12);
    expect(bankPosition([], TODAY).known).toBe(false);
  });
});

describe("Prévisions de trésorerie – 3 scénarios", () => {
  it("applique des règles d'encaissement de plus en plus prudentes", () => {
    const base = { id: "x", type: "invoice" as const, direction: "receivable" as const, number: "F1", project_id: null, party_id: null,
      issue_date: "2026-09-01", total: 100, paid: 0, open: 100, disputed: false, bucket: "not_due" as const };
    const notDue = { ...base, due_date: "2026-11-10", daysOverdue: -9 };
    const late45 = { ...base, due_date: "2026-09-17", daysOverdue: 45 };
    expect(expectedCollectionDate(notDue, "optimistic", TODAY, undefined)).toBe("2026-11-10");
    expect(expectedCollectionDate(notDue, "realistic", TODAY, undefined)).toBe("2026-11-25");
    expect(expectedCollectionDate(notDue, "pessimistic", TODAY, undefined)).toBe("2026-12-10");
    expect(expectedCollectionDate(late45, "optimistic", TODAY, undefined)).toBe("2026-11-08");
    expect(expectedCollectionDate(late45, "realistic", TODAY, undefined)).toBe("2026-12-01");
    expect(expectedCollectionDate(late45, "pessimistic", TODAY, undefined)).toBeNull();
    expect(expectedCollectionDate({ ...notDue, disputed: true }, "optimistic", TODAY, undefined)).toBeNull();
  });

  it("calcule soldes et points bas à 7/30/90 jours", () => {
    const d = emptyData();
    d.bankBalances.push({ account_label: "Courant", balance: 3_000_000, as_of: "2026-10-31", source: "manual" });
    d.invoices.push(issued({ amount_excl: 2_000_000, vat_amount: 0, due_date: "2026-11-20" }));
    d.invoices.push(received({ amount_excl: 2_500_000, vat_amount: 0, due_date: "2026-11-03" }));
    d.obligations.push(obligation({ amount: 1_000_000, next_due_date: "2026-11-28", label: "Salaires" }));
    const fc = allForecasts(d, TODAY);
    expect(fc.optimistic.horizons[7].closing).toBe(500_000);
    expect(fc.optimistic.horizons[30].closing).toBe(1_500_000);
    // réaliste : échéance 20/11 + 15 j de retard moyen = 05/12, au-delà de l'horizon de 30 j (01/12)
    expect(fc.realistic.horizons[30].inflow).toBe(0);
    expect(fc.realistic.horizons[90].inflow).toBe(2_000_000);
    expect(fc.realistic.horizons[30].minBalance).toBe(-500_000);
  });

  it("le scénario réaliste décale l'encaissement selon le retard client", () => {
    const d = emptyData();
    d.bankBalances.push({ account_label: "Courant", balance: 1_000_000, as_of: "2026-10-31", source: "manual" });
    d.invoices.push(issued({ amount_excl: 2_000_000, vat_amount: 0, due_date: "2026-11-20" }));
    d.invoices.push(received({ amount_excl: 1_500_000, vat_amount: 0, due_date: "2026-11-25" }));
    const fc = allForecasts(d, TODAY);
    expect(fc.optimistic.horizons[30].minBalance).toBe(1_000_000);   // encaissé le 20/11 avant la sortie du 25/11
    expect(fc.realistic.horizons[30].inflow).toBe(0);                // attendu le 05/12, hors horizon 30 j
    expect(fc.realistic.horizons[30].minBalance).toBe(-500_000);     // ⇒ manque de trésorerie détecté
    expect(fc.realistic.horizons[90].closing).toBe(1_500_000);
  });

  it("sans solde bancaire, les flux sont calculés mais pas les soldes", () => {
    const d = emptyData();
    d.invoices.push(issued({ amount_excl: 100, due_date: "2026-11-05" }));
    const fc = allForecasts(d, TODAY);
    expect(fc.optimistic.startBalance).toBeNull();
    expect(fc.optimistic.horizons[7].closing).toBeNull();
    expect(fc.optimistic.horizons[7].inflow).toBeGreaterThan(0);
  });
});

describe("Synthèse entreprise", () => {
  it("sépare chiffre facturé, encaissé et dettes", () => {
    const d = emptyData();
    const p = project();
    d.projects.push(p);
    const inv = issued({ project_id: p.id, amount_excl: 1_000_000 });
    d.invoices.push(inv);
    d.payments.push(payment({ invoice_id: inv.id, amount: 500_000 }));
    const s = companySummary(d, TODAY);
    expect(s.revenueInvoicedExcl).toBe(1_000_000);
    expect(s.cashCollected).toBe(500_000);
    expect(s.receivablesOpen).toBe(inv.amount_total - 500_000);
    expect(s.bank.known).toBe(false);
  });
});
