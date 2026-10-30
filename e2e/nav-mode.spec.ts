import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const nav = (page: Page) => page.getByRole("navigation", { name: "Primary" });
const link = (page: Page, name: string) => nav(page).getByRole("link", { name, exact: true });

test("navigation: simple by default, everything one click away, remembered, and never a way around permissions", async ({
  page,
  browser,
}) => {
  await signIn(page, "owner@acme.test");
  await page.goto("/en/w/acme");

  // New people see the everyday work only.
  for (const name of ["Overview", "Goals", "Tasks", "Projects", "Chat", "Schedule", "Members"]) {
    await expect(link(page, name)).toBeVisible();
  }
  for (const name of ["CRM", "Forms", "Knowledge", "Insights", "Plan", "Files", "Assistant"]) {
    await expect(link(page, name)).toHaveCount(0);
  }

  // One button shows the rest, and the choice sticks across pages and reloads.
  await nav(page).getByRole("button", { name: "Show all features" }).click();
  await expect(link(page, "CRM")).toBeVisible();
  await expect(link(page, "Plan")).toBeVisible();
  await page.goto("/en/w/acme/tasks");
  await expect(link(page, "Insights")).toBeVisible();
  await page.reload();
  await expect(link(page, "Insights")).toBeVisible();

  // ...and one button hides it again. A hidden page still opens, and stays listed while open.
  await nav(page).getByRole("button", { name: "Show essentials only" }).click();
  await expect(link(page, "CRM")).toHaveCount(0);
  await page.goto("/en/w/acme/crm");
  await expect(link(page, "CRM")).toBeVisible();
  await expect(link(page, "Insights")).toHaveCount(0);

  // The view is a preference of one browser: another browser starts simple.
  const other = await browser.newContext();
  const fresh = await other.newPage();
  await signIn(fresh, "owner@acme.test");
  await fresh.goto("/en/w/acme");
  await expect(link(fresh, "CRM")).toHaveCount(0);
  await nav(fresh).getByRole("button", { name: "Show all features" }).click();
  await expect(link(fresh, "CRM")).toBeVisible();
  await other.close();
  await page.goto("/en/w/acme");
  await expect(link(page, "CRM")).toHaveCount(0);

  // The full view lists only what a person may open: a viewer never gets Plan.
  await signIn(page, "viewer@acme.test");
  await page.goto("/en/w/acme");
  await nav(page).getByRole("button", { name: "Show all features" }).click();
  await expect(link(page, "Plan")).toHaveCount(0);
  await nav(page).getByRole("button", { name: "Show essentials only" }).click();
});
