import { expect, type Page } from "@playwright/test";

export const PASSWORD = process.env.DEMO_PASSWORD ?? "";
export async function login(page: Page, email = "owner@madibu.test") {
  if (!PASSWORD) throw new Error("DEMO_PASSWORD requis pour les tests E2E");
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await expect(page).toHaveURL(/\/dashboard/);
}
export const uid = () => Math.random().toString(36).slice(2, 7).toUpperCase();
