import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// Uses the globex tenant (one owner) so the acme dashboard assertions are unaffected.
test("an owner creates a challenge, turns the leaderboard on and opts in", async ({ page }) => {
  await signIn(page, "owner@globex.test");
  await page.goto("/en/w/globex/progress");
  await expect(page.getByRole("heading", { name: "Progress", level: 1 })).toBeVisible();
  await expect(page.getByText(/Points recognise finished work/)).toBeVisible();
  await expect(page.getByText("The leaderboard is turned off for this workspace.")).toBeVisible();

  await page.getByLabel("Title", { exact: true }).fill("Autumn push");
  await page.getByLabel("Tasks to complete").fill("5");
  await page.getByLabel("Starts").fill("2026-10-01");
  await page.getByLabel("Ends").fill("2026-12-31");
  await page.getByRole("button", { name: "Create challenge" }).click();
  await expect(page.getByText("Autumn push")).toBeVisible();
  await expect(page.getByText("0 / 5")).toBeVisible();

  await page.getByRole("button", { name: "Turn leaderboard on" }).click();
  await expect(
    page.getByText("Rankings are on, and only members who opted in appear."),
  ).toBeVisible();
  await expect(page.getByText("You do not appear on the leaderboard.")).toBeVisible();
  await page.getByRole("button", { name: "Show me on the leaderboard" }).click();
  await expect(page.getByText("You appear on the leaderboard.")).toBeVisible();
  await page.getByRole("button", { name: "Turn leaderboard off" }).click();
  await expect(page.getByText("The leaderboard is turned off for this workspace.")).toBeVisible();
});

test("a viewer sees their own progress but no management forms", async ({ page }) => {
  await signIn(page, "viewer@acme.test");
  await page.goto("/en/w/acme/progress");
  await expect(page.getByRole("heading", { name: "Progress", level: 1 })).toBeVisible();
  await expect(page.getByText("Create a challenge")).toHaveCount(0);
  await expect(page.getByText("Leaderboard policy")).toHaveCount(0);
});
