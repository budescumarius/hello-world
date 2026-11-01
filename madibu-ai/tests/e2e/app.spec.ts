import { expect, test } from "@playwright/test";
import { login, uid } from "./helpers";

test.describe("Authentification et accès", () => {
  test("redirige vers la connexion et refuse un mauvais mot de passe", async ({ page }) => {
    await page.goto("/financial");
    await expect(page).toHaveURL(/\/login/);
    await page.fill("#email", "owner@madibu.test");
    await page.fill("#password", "mauvais-mot-de-passe");
    await page.click("button[type=submit]");
    await expect(page.getByText("Identifiants incorrects.")).toBeVisible();
  });

  test("l'API refuse les appels non authentifiés", async ({ request }) => {
    expect((await request.get("/api/export/financial", { maxRedirects: 0 })).status()).toBe(401);
    expect((await request.post("/api/ai/chat", { data: { messages: [] }, maxRedirects: 0 })).status()).toBe(401);
    expect((await request.get("/api/cron/daily")).status()).toBe(401);
  });

  test("un chef de chantier ne voit ni finances ni approbations", async ({ page }) => {
    await login(page, "site.manager@madibu.test");
    const nav = page.getByRole("navigation", { name: "Navigation principale" }).first();
    await expect(nav.getByText("Chantiers")).toBeVisible();
    await expect(nav.getByText("Finances")).toHaveCount(0);
    await expect(nav.getByText("Approbations")).toHaveCount(0);
    await expect(page.getByTestId("kpi-receivables")).toHaveCount(0);
    await page.goto("/projects");
    await expect(page.getByTestId("projects-table")).toContainText("MAD-2026-007");
    await expect(page.getByTestId("projects-table")).not.toContainText("MAD-2026-014"); // non assigné
    const res = await page.request.get("/api/export/financial");
    expect(res.status()).toBe(403);
  });
});

test.describe("Tableau de bord et finances (OWNER)", () => {
  test.beforeEach(async ({ page }) => login(page));

  test("affiche les indicateurs distincts facturé / encaissé / dettes", async ({ page }) => {
    await expect(page.getByTestId("kpi-cash")).toContainText("saisie manuelle");
    await expect(page.getByTestId("kpi-invoiced")).toContainText("Encaissé");
    await expect(page.getByTestId("kpi-receivables")).toContainText("en retard");
    await expect(page.getByTestId("kpi-payables")).toBeVisible();
  });

  test("crée, consulte puis archive un chantier", async ({ page }) => {
    const ref = `E2E-${uid()}`;
    await page.goto("/projects");
    await page.getByTestId("new-project").click();
    await page.fill("input[name=reference]", ref);
    await page.fill("input[name=name]", "Chantier de test E2E");
    await page.selectOption("select[name=status]", "signed");
    await page.fill("input[name=contract_amount_excl]", "45000");
    await page.fill("input[name=budget_materials]", "15000");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByTestId("projects-table")).toContainText(ref);
    await page.getByRole("link", { name: ref }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(ref);
    await expect(page.getByText("Données manquantes")).toBeVisible(); // client, fin prévue
    page.on("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Archiver" }).click();
    await expect(page.getByRole("button", { name: "Restaurer" })).toBeVisible();
    await page.goto("/projects");
    await expect(page.getByTestId("projects-table")).not.toContainText(ref);
  });

  test("refuse une facture dont l'échéance précède l'émission", async ({ page }) => {
    await page.goto("/financial?tab=customer");
    await page.getByTestId("new-issued-invoice").click();
    await page.fill("input[name=number]", `E2E-${uid()}`);
    await page.selectOption("select[name=client_id]", { index: 1 });
    await page.fill("input[name=issue_date]", "2026-10-10");
    await page.fill("input[name=due_date]", "2026-10-01");
    await page.fill("input[name=amount_excl]", "1000");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("L'échéance précède la date d'émission")).toBeVisible();
  });

  test("enregistre une facture puis un encaissement partiel", async ({ page }) => {
    const num = `E2E-${uid()}`;
    await page.goto("/financial?tab=customer");
    await page.getByTestId("new-issued-invoice").click();
    await page.fill("input[name=number]", num);
    await page.selectOption("select[name=client_id]", { index: 1 });
    await page.fill("input[name=amount_excl]", "1000");
    await page.selectOption("select[name=vat_rate]", "21");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    const row = page.getByTestId("issued-invoices").locator("tr", { hasText: num });
    await expect(row).toContainText("1 210,00");
    await expect(row).toContainText("Impayée");
    await row.getByRole("button", { name: "Encaissement" }).click();
    await page.fill("input[name=amount]", "500");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(row).toContainText("Partielle");
    await expect(row).toContainText("710,00");
    // le surpaiement est refusé par la base
    await row.getByRole("button", { name: "Encaissement" }).click();
    await page.fill("input[name=amount]", "5000");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByRole("alert").first()).toContainText("dépasse le solde");
  });

  test("affiche les trois scénarios de prévision", async ({ page }) => {
    await page.goto("/financial?tab=forecast");
    for (const s of ["optimistic", "realistic", "pessimistic"]) await expect(page.getByTestId(`scenario-${s}`)).toContainText("90 j");
  });
});

test.describe("Tâches, analyse et approbations", () => {
  test.beforeEach(async ({ page }) => login(page));

  test("crée une tâche et la fait avancer dans le Kanban", async ({ page }) => {
    const title = `Tâche E2E ${uid()}`;
    await page.goto("/tasks");
    await page.getByTestId("new-task").click();
    await page.fill("input[name=title]", title);
    await page.selectOption("select[name=priority]", "high");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByTestId("tasks-table")).toContainText(title);
    await page.getByRole("link", { name: "Kanban" }).click();
    const card = page.getByTestId("kanban").locator("div.rounded-lg", { hasText: title });
    await card.getByRole("combobox", { name: "Statut" }).selectOption("in_progress");
    await page.reload();
    const col = page.getByTestId("kanban").locator("div.rounded-xl", { hasText: "En cours (" });
    await expect(col).toContainText(title);
  });

  test("l'analyse prépare des rappels que seul un humain approuve", async ({ page }) => {
    await page.getByTestId("run-analysis").click();
    await expect(page.getByText(/Analyse terminée/)).toBeVisible({ timeout: 60_000 });
    await page.reload();
    await expect(page.getByTestId("alerts")).toContainText("impayée depuis");
    await page.goto("/approvals");
    const first = page.getByTestId("approval").first();
    await expect(first).toContainText("Envoyer un e-mail");
    await expect(first).toContainText("IA");
    page.once("dialog", (d) => d.accept("OK pour envoi"));
    await first.getByRole("button", { name: "Approuver" }).click();
    await expect(page.getByText("Demande approuvée")).toBeVisible();
    const approved = page.getByTestId("approval").filter({ hasText: "Approuvée" }).first();
    page.once("dialog", (d) => d.accept("Envoyé depuis Outlook"));
    await approved.getByRole("button", { name: "Marquer comme exécutée" }).click();
    await expect(page.getByTestId("approval").filter({ hasText: "Exécutée" }).first()).toContainText("Envoyé depuis Outlook");
  });

  test("le rapport financier quotidien porte le titre exigé", async ({ page }) => {
    await page.goto("/financial");
    await page.getByRole("link", { name: /Rapport financier quotidien/ }).click();
    await expect(page.getByTestId("report")).toContainText("MADIBU – DAILY FINANCIAL REPORT");
    await expect(page.getByTestId("report")).toContainText("7. Actions recommandées");
  });

  test("l'import CSV refuse un fichier avec erreurs et n'écrit rien", async ({ page }) => {
    await page.goto("/settings");
    const ref = `CSV-${uid()}`;
    const csv = `reference;name;status;contract_amount_excl;vat_rate\n${ref};Import OK;signed;12 500,50;6\n;Sans référence;signed;abc;7\n`;
    await page.getByTestId("csv-file").setInputFiles({ name: "chantiers.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.getByRole("button", { name: "Vérifier" }).click();
    await expect(page.getByTestId("csv-result")).toContainText("Ligne 3");
    await expect(page.getByTestId("csv-commit")).toBeDisabled();
    const good = `reference;name;status;contract_amount_excl;vat_rate\n${ref};Import OK;signed;12 500,50;6\n`;
    await page.getByTestId("csv-file").setInputFiles({ name: "chantiers.csv", mimeType: "text/csv", buffer: Buffer.from(good) });
    await page.getByRole("button", { name: "Vérifier" }).click();
    await page.getByTestId("csv-commit").click();
    await expect(page.getByTestId("csv-result")).toContainText("1 ligne(s) écrite(s)");
    await page.goto(`/projects?q=${ref}`);
    await expect(page.getByTestId("projects-table")).toContainText("12 501"); // 12 500,50 € arrondi à l'euro
  });

  test("bascule l'interface en roumain", async ({ page }) => {
    await page.getByRole("button", { name: "RO", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "Panou de control" })).toBeVisible();
    await expect(page.getByRole("button", { name: "RO", exact: true }).first()).toBeDisabled();
    await expect(page.getByRole("button", { name: "FR", exact: true }).first()).toBeEnabled();
    await page.getByRole("button", { name: "FR", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "Tableau de bord" })).toBeVisible();
  });
});

test.describe("Documents", () => {
  test("téléverse un PDF sur un chantier puis le télécharge via un lien signé", async ({ page }) => {
    await login(page);
    await page.goto("/documents");
    const name = `contrat-${uid()}.pdf`;
    await page.getByTestId("doc-file").setInputFiles({ name, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% test MADIBU\n") });
    await page.locator("select[name=project_id]").first().selectOption({ index: 1 });
    await page.locator("select[name=category]").first().selectOption("contract");
    await page.getByRole("button", { name: "Téléverser" }).click();
    await expect(page.getByTestId("documents-table")).toContainText(name);
    const href = await page.getByRole("link", { name }).getAttribute("href");
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect((await res.body()).toString()).toContain("test MADIBU");
  });

  test("refuse un type de fichier non autorisé", async ({ page }) => {
    await login(page);
    await page.goto("/documents");
    await page.getByTestId("doc-file").setInputFiles({ name: "script.sh", mimeType: "application/x-sh", buffer: Buffer.from("echo") });
    await page.getByRole("button", { name: "Téléverser" }).click();
    await expect(page.getByText(/Type de fichier non autorisé/)).toBeVisible();
  });
});
