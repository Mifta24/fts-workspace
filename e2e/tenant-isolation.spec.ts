import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.describe("tenant isolation and roles", () => {
  test("anonymous visitors are sent to sign-in", async ({ page }) => {
    await page.goto("/en/w/acme");
    await expect(page).toHaveURL(/\/en\/sign-in$/);
  });

  test("another tenant's workspace and records look nonexistent", async ({ page }) => {
    await signIn(page, "owner@acme.test");
    const foreignTaskId = process.env.E2E_FOREIGN_TASK_ID;
    expect(foreignTaskId).toBeTruthy();

    const paths = [
      "/en/w/globex",
      "/en/w/globex/tasks",
      `/en/w/acme/tasks/${foreignTaskId}`,
      "/en/w/acme/tasks/not-a-uuid",
      "/en/w/does-not-exist",
    ];
    for (const path of paths) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
      await expect(page.getByRole("heading", { name: "Page not found" }), path).toBeVisible();
    }
    await expect(page.getByText("Globex secret task")).toHaveCount(0);
  });

  test("a viewer can read but is offered no create forms", async ({ page }) => {
    await signIn(page, "viewer@acme.test");
    for (const [path, heading] of [
      ["/en/w/acme/projects", "Create a project"],
      ["/en/w/acme/goals", "Create a goal"],
      ["/en/w/acme/tasks", "Create a task"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }), path).toBeVisible();
      await expect(page.getByText(heading, { exact: true }), path).toHaveCount(0);
    }
  });
});
