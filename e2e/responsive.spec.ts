import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// Phone width: no page may scroll sideways, and the primary navigation must stay reachable.
test.use({ viewport: { width: 375, height: 812 } });

const PAGES = [
  "/en/workspaces",
  "/en/w/acme",
  "/en/w/acme/projects",
  "/en/w/acme/goals",
  "/en/w/acme/tasks",
];

test("pages fit a 375px-wide screen without horizontal page scroll", async ({ page }) => {
  await signIn(page, "owner@acme.test");
  for (const path of PAGES) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${path} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
  }
});

test("workspace navigation is usable on a phone", async ({ page }) => {
  await signIn(page, "owner@acme.test");
  await page.goto("/en/w/acme");
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav).toBeVisible();
  await nav.getByRole("link", { name: "Tasks", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/w\/acme\/tasks$/);
  const box = await nav.getByRole("link", { name: "Tasks", exact: true }).boundingBox();
  // Touch targets should be at least 24px tall (WCAG 2.2 target size minimum).
  expect(box!.height).toBeGreaterThanOrEqual(24);
});
