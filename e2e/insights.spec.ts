import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("insights: totals by role, period switch, and no other tenant's data", async ({ page }) => {
  await signIn(page, "owner@acme.test");
  await page.goto("/en/w/acme/insights");
  await expect(page.getByRole("heading", { name: "Insights", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contacts and consent" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Forms", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your meetings" })).toBeVisible();

  await page.getByRole("link", { name: "7 days" }).click();
  await expect(page).toHaveURL(/days=7/);
  await expect(page.getByRole("link", { name: "7 days" })).toHaveAttribute("aria-current", "page");
  // An unknown period falls back to the default instead of failing.
  expect((await page.goto("/en/w/acme/insights?days=9999"))?.status()).toBe(200);
  await expect(page.getByRole("link", { name: "30 days" })).toHaveAttribute("aria-current", "page");
});

test("insights: viewers see only their own meetings, and other tenants are 404", async ({
  page,
}) => {
  await signIn(page, "viewer@acme.test");
  await page.goto("/en/w/acme/insights");
  await expect(page.getByRole("heading", { name: "Your meetings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contacts and consent" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Forms", level: 2 })).toHaveCount(0);

  await signIn(page, "owner@globex.test");
  expect((await page.goto("/en/w/acme/insights"))?.status()).toBe(404);
});
