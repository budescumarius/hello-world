import { defineConfig, devices } from "@playwright/test";

/**
 * Tests de bout en bout : nécessitent Supabase local démarré + données de démonstration
 * (`npx supabase db reset && DEMO_PASSWORD=... npm run seed:demo`).
 * PW_CHROMIUM_PATH permet d'utiliser un Chromium déjà installé.
 */
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", trace: "retain-on-failure", locale: "fr-BE", timezoneId: "Europe/Brussels",
    launchOptions: { executablePath } },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"], launchOptions: { executablePath } }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: { command: "npm run dev", url: "http://localhost:3000/login", reuseExistingServer: true, timeout: 120_000 },
});
