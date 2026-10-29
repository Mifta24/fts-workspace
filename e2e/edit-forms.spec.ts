import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// Uses the globex tenant so its data never affects the acme dashboard assertions.
test("an owner edits a project, goal and task", async ({ page }) => {
  await signIn(page, "owner@globex.test");

  // Project.
  await page.goto("/en/w/globex/projects");
  await page.getByLabel("Project name").fill("Alpha");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("link", { name: "Alpha", exact: true }).click();
  // The list page has a create form with the same labels; wait for the edit page.
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  await page.getByLabel("Project name").fill("Alpha renamed");
  await page.getByLabel("Description (optional)").fill("Pilot");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.getByRole("link", { name: "Back to projects" }).click();
  await expect(page.getByRole("link", { name: "Alpha renamed" })).toBeVisible();
  await expect(page.getByText("Pilot")).toBeVisible();

  // Goal.
  await page.goto("/en/w/globex/goals");
  await page.getByLabel("Goal title").fill("Goal one");
  await page.getByRole("button", { name: "Create goal" }).click();
  await page.getByRole("link", { name: "Goal one", exact: true }).click();
  await expect(page).toHaveURL(/\/goals\/[0-9a-f-]{36}$/);
  await page.getByLabel("Goal title").fill("Goal one v2");
  await page.getByLabel("Status").selectOption({ label: "Completed" });
  await page.getByLabel("Progress (%)").fill("60");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.getByRole("link", { name: "Back to goals" }).click();
  await expect(page.getByRole("link", { name: "Goal one v2" })).toBeVisible();
  await expect(page.getByText(/Completed/)).toBeVisible();
  await expect(page.getByText("60%")).toBeVisible();

  // Task.
  await page.goto("/en/w/globex/tasks");
  await page.getByLabel("Task title").fill("Task one");
  await page.getByRole("button", { name: "Create task" }).click();
  await page.getByRole("link", { name: "Task one", exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
  await page.getByLabel("Task title").fill("Task one v2");
  await page.getByLabel("Priority").selectOption({ label: "High" });
  await page.getByLabel("Assignee").selectOption({ label: "Globex Owner" });
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Task one v2" })).toBeVisible();
  await expect(page.getByText(/High · Globex Owner/)).toBeVisible();
});

test("a viewer cannot open edit pages", async ({ page }) => {
  await signIn(page, "viewer@acme.test");
  for (const path of [
    "/en/w/acme/projects/00000000-0000-7000-8000-000000000000",
    "/en/w/acme/goals/00000000-0000-7000-8000-000000000000",
  ]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
  }
});
