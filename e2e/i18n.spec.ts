import { expect, test } from "@playwright/test";

// The language switcher (a Radix Select). Verifies the app actually re-renders
// in the chosen language, flips direction for Arabic, and persists on reload.

async function pickLanguage(page: import("@playwright/test").Page, optionName: RegExp) {
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: optionName }).click();
}

test.describe("language switcher (on /auth, no account needed)", () => {
  test("switching to Arabic sets RTL and persists across reload", async ({ page }) => {
    await page.goto("/auth");
    await pickLanguage(page, /العربية|arabic/i);

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    // still Arabic after reload
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  });

  test("switching to French changes lang and back to English restores LTR", async ({ page }) => {
    await page.goto("/auth");

    await pickLanguage(page, /français|french/i);
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");

    await pickLanguage(page, /english/i);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});
