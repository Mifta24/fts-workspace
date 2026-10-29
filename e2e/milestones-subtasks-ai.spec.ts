import { PrismaPg } from "@prisma/adapter-pg";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "../src/generated/prisma/client";
import { E2E_DATABASE_URL } from "./e2e-env";
import { signIn } from "./helpers";

// Uses the globex tenant so its data never affects the acme dashboard assertions.
test("milestones drive goal progress, and an AI draft is reviewed before it creates tasks", async ({
  page,
}) => {
  await signIn(page, "owner@globex.test");

  // Milestone-based goal.
  await page.goto("/en/w/globex/goals");
  await page.getByLabel("Goal title").fill("Milestone goal");
  await page.getByLabel("Progress tracking").selectOption({ label: "From milestones" });
  await page.getByRole("button", { name: "Create goal" }).click();
  await page.getByRole("link", { name: "Milestone goal", exact: true }).click();
  await expect(page).toHaveURL(/\/goals\/[0-9a-f-]{36}$/);
  const goalId = /goals\/([0-9a-f-]{36})$/.exec(page.url())![1]!;

  await page.getByLabel("Milestone title").fill("Beta release");
  await page.getByRole("button", { name: "Add milestone" }).click();
  await expect(page.getByText("Beta release")).toBeVisible();
  await page.getByRole("button", { name: "Mark done" }).click();
  await expect(page.getByText(/^Done/)).toBeVisible();
  await page.goto("/en/w/globex/goals");
  await expect(page.getByText("100%")).toBeVisible();

  // AI planning is disabled without provider configuration.
  await page.goto(`/en/w/globex/goals/${goalId}/plan`);
  await expect(page.getByText(/AI planning is not configured/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate draft" })).toHaveCount(0);

  // A draft (stored directly, as the model is not available in E2E) is reviewed, edited and applied.
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: E2E_DATABASE_URL }),
  });
  try {
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: "owner@globex.test" } });
    const organization = await prisma.organization.findUniqueOrThrow({ where: { slug: "globex" } });
    const plan = await prisma.aiTaskPlan.create({
      data: {
        organizationId: organization.id,
        goalId,
        requestedById: owner.id,
        objective: "Ship the beta to early customers.",
        provider: "e2e",
        model: "e2e",
        draft: [
          { title: "Prepare beta build", priority: "HIGH", estimatedDays: 2 },
          { title: "Invite early customers", priority: "MEDIUM" },
          { title: "Skip this suggestion", priority: "LOW" },
        ],
      },
    });
    await page.goto(`/en/w/globex/goals/${goalId}/plan/${plan.id}`);
  } finally {
    await prisma.$disconnect();
  }
  await expect(page.getByRole("heading", { name: "Review the draft" })).toBeVisible();
  await page.getByLabel("Title of task 1").fill("Prepare beta build (edited)");
  await page.getByLabel("Include task 3").uncheck();
  await page.getByRole("button", { name: "Create selected tasks" }).click();

  await expect(page).toHaveURL(/\/en\/w\/globex\/tasks$/);
  await expect(page.getByRole("link", { name: "Prepare beta build (edited)" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Invite early customers" })).toBeVisible();
  await expect(page.getByText("Skip this suggestion")).toHaveCount(0);

  // The applied plan cannot be applied again.
  await page.goBack();
  await page.goto(`/en/w/globex/goals/${goalId}/plan/${await latestPlanId(goalId)}`);
  await expect(page.getByText("This plan was already applied.")).toBeVisible();
});

test("subtasks are created under a parent and linked both ways", async ({ page }) => {
  await signIn(page, "owner@globex.test");
  await page.goto("/en/w/globex/tasks");
  await page.getByLabel("Task title").fill("Parent job");
  await page.getByRole("button", { name: "Create task" }).click();
  await expect(page.getByRole("link", { name: "Parent job", exact: true })).toBeVisible();

  await page.getByLabel("Task title").fill("Child job");
  await page.getByLabel("Parent task").selectOption({ label: "Parent job" });
  await page.getByRole("button", { name: "Create task" }).click();

  await page.getByRole("link", { name: "Child job", exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Subtask of")).toBeVisible();
  await page.getByRole("link", { name: "Parent job", exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Subtasks" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Child job", exact: true })).toBeVisible();
});

async function latestPlanId(goalId: string): Promise<string> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: E2E_DATABASE_URL }),
  });
  try {
    const plan = await prisma.aiTaskPlan.findFirstOrThrow({
      where: { goalId },
      orderBy: { createdAt: "desc" },
    });
    return plan.id;
  } finally {
    await prisma.$disconnect();
  }
}
