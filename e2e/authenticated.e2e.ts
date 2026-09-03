import { expect, test } from "@playwright/test";

// Signed-in flows. Skipped unless you provide a real, already-onboarded test
// account:  E2E_EMAIL=... E2E_PASSWORD=... npm run test:e2e
//
// A seeded account is required because sign-up needs email confirmation and new
// accounts land on /onboarding. Point this at a throwaway user that has already
// completed onboarding.

const EMAIL = process.env["E2E_EMAIL"];
const PASSWORD = process.env["E2E_PASSWORD"];

test.describe("authenticated", () => {
  test.skip(!EMAIL || !PASSWORD, "set E2E_EMAIL and E2E_PASSWORD to run these");

  test.beforeEach(async ({ page }) => {
    await page.goto("/auth");
    await page.locator('input[type="email"]').fill(EMAIL!);
    await page.locator('input[type="password"]').fill(PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/(chat|onboarding|dashboard)/, { timeout: 20_000 });
  });

  test("chat page loads with a composer", async ({ page }) => {
    await page.goto("/chat");
    await expect(page).toHaveURL(/\/chat/);
    await expect(page.getByRole("textbox").first()).toBeVisible();
  });

  test("settings shows the Phase 2/3 additions", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: /emails from kalm/i })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /what kalm remembers about you/i }),
    ).toBeVisible();
    // the opt-out switch is present
    await expect(page.getByRole("switch")).toBeVisible();
  });

  test("crisis resources stay reachable while signed in", async ({ page }) => {
    await page.goto("/care");
    await expect(page).toHaveURL(/\/care/);
  });
});
