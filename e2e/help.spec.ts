import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

const PAGES = [
  { locale: "en", title: "How to use FTS Workspace", section: "Get started in five steps" },
  { locale: "id", title: "Cara memakai FTS Workspace", section: "Mulai dalam lima langkah" },
  { locale: "ja", title: "FTS Workspace の使い方", section: "5つのステップで始める" },
] as const;

for (const { locale, title, section } of PAGES) {
  test(`help guide (${locale}): public, one h1, every section present, no leaked keys`, async ({
    page,
  }) => {
    // Anonymous: no sign-in needed.
    await page.goto(`/${locale}/help`);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 2, name: section })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(13);
    await expect(page.locator("main")).not.toContainText(/Help\.|sections\./);
  });
}

test("help guide: linked from the home page and the footer, and fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/en");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "How to use" })
    .click();
  await expect(page).toHaveURL(/\/en\/help$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );

  await page.goto("/en/privacy");
  await page
    .getByRole("navigation", { name: "Legal" })
    .getByRole("link", { name: "How to use" })
    .click();
  await expect(page).toHaveURL(/\/en\/help$/);
});

test("help guide: signed-in people reach it from the workspace top bar", async ({ page }) => {
  await signIn(page, "viewer@acme.test");
  await page.goto("/en/w/acme");
  await page.getByRole("link", { name: "How to use" }).first().click();
  await expect(page).toHaveURL(/\/en\/help$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "How to use FTS Workspace" }),
  ).toBeVisible();
});
