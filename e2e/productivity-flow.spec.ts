import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("an owner plans a project, goal and task and sees progress on the dashboard", async ({
  page,
}) => {
  await signIn(page, "owner@acme.test");
  await page.getByRole("link", { name: "Open" }).first().click();
  await expect(page).toHaveURL(/\/en\/w\/acme$/);

  // Empty dashboard guides the user to the first goal.
  await expect(
    page.getByText("Nothing here yet. Start by creating your first goal."),
  ).toBeVisible();
  await page.getByRole("link", { name: "Create your first goal" }).click();
  await expect(page.getByRole("heading", { name: "Goals", exact: true })).toBeVisible();

  // Project.
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.getByLabel("Project name").fill("Website relaunch");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByText("Website relaunch")).toBeVisible();

  // Task-based goal inside that project.
  await page.getByRole("link", { name: "Goals", exact: true }).click();
  await page.getByLabel("Goal title").fill("Launch website");
  await page.getByLabel("Project", { exact: true }).selectOption({ label: "Website relaunch" });
  await page.getByLabel("Progress tracking").selectOption({ label: "From tasks" });
  await page.getByRole("button", { name: "Create goal" }).click();
  await expect(
    page.getByRole("listitem").getByText("Launch website", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/No progress yet/)).toBeVisible();

  // Task linked to the goal and assigned to the owner.
  await page.getByRole("link", { name: "Tasks", exact: true }).click();
  await page.getByLabel("Task title").fill("Design homepage");
  await page.getByLabel("Assignee").selectOption({ label: "Acme Owner" });
  await page.getByLabel("Goal", { exact: true }).selectOption({ label: "Launch website" });
  await page.getByRole("button", { name: "Create task" }).click();
  await page.getByRole("link", { name: "Design homepage" }).click();

  // Complete it and comment.
  await page.getByLabel("Status").selectOption({ label: "Completed" });
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/^Completed · /)).toBeVisible();
  await page.getByLabel("Add a comment").fill("Shipped the first draft.");
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect(page.getByText("Shipped the first draft.")).toBeVisible();

  // Goal progress follows the task.
  await page.getByRole("link", { name: "Goals", exact: true }).click();
  await expect(page.getByText("100%")).toBeVisible();

  // Dashboard reflects the work.
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  const card = (name: string) => page.locator(`dt:has-text("${name}") + dd`);
  await expect(card("Active goals")).toHaveText("1");
  await expect(card("Completed tasks")).toHaveText("1");
  await expect(card("Overdue tasks")).toHaveText("0");
  await expect(card("Task progress")).toHaveText("100%");
});
