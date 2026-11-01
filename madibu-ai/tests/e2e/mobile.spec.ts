import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("navigation mobile par le menu", async ({ page }) => {
  await login(page);
  // le bouton n'est actif qu'après l'hydratation : on réessaie jusqu'à l'ouverture du menu
  await expect(async () => {
    await page.getByRole("button", { name: "Ouvrir le menu" }).click();
    await expect(page.getByRole("button", { name: "Fermer le menu" })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  await page.getByRole("navigation", { name: "Navigation principale" }).last().getByRole("link", { name: "Tâches" }).click();
  await expect(page).toHaveURL(/\/tasks/);
  await expect(page.getByRole("heading", { name: "Tâches" })).toBeVisible();
});
