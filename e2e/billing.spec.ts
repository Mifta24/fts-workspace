import { PrismaPg } from "@prisma/adapter-pg";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "../src/generated/prisma/client";
import { E2E_DATABASE_URL } from "./e2e-env";
import { signIn } from "./helpers";

// Plans and suspension change the shared database; put globex back whatever happens.
test.afterEach(async () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: E2E_DATABASE_URL }),
  });
  try {
    const globex = await prisma.organization.findUniqueOrThrow({ where: { slug: "globex" } });
    await prisma.subscription.deleteMany({ where: { organizationId: globex.id } });
    await prisma.organization.update({ where: { id: globex.id }, data: { suspendedAt: null } });
  } finally {
    await prisma.$disconnect();
  }
});

test("billing: owners see plan and usage, viewers and other tenants do not", async ({ page }) => {
  await signIn(page, "owner@acme.test");
  await page.goto("/en/w/acme/billing");
  await expect(page.getByRole("heading", { name: "Plan and usage", level: 1 })).toBeVisible();
  await expect(page.getByTestId("plan-name")).toHaveText("Unmetered");
  await expect(page.getByRole("heading", { name: "Usage", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Included features" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Plan" }),
  ).toBeVisible();

  await signIn(page, "viewer@acme.test");
  expect((await page.goto("/en/w/acme/billing"))?.status()).toBe(404);
  await expect(
    page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Plan" }),
  ).toHaveCount(0);

  await signIn(page, "owner@globex.test");
  expect((await page.goto("/en/w/acme/billing"))?.status()).toBe(404);
});

test("operator console: hidden from everyone else, sets a plan, suspends and restores", async ({
  page,
}) => {
  // Not an operator: the console does not exist.
  await signIn(page, "owner@acme.test");
  expect((await page.goto("/en/admin"))?.status()).toBe(404);

  await signIn(page, "operator@platform.test");
  await page.goto("/en/admin");
  await expect(page.getByRole("heading", { name: "Operator console", level: 1 })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Platform health (last 24 hours)" }),
  ).toBeVisible();
  const globex = page.getByTestId("workspace-globex");
  await expect(globex).toBeVisible();

  await globex.getByLabel("Plan").selectOption("FREE");
  await globex.getByRole("button", { name: "Set plan" }).click();
  await expect(globex.getByText("Saved")).toBeVisible();
  await expect(globex.getByText("Free", { exact: true }).first()).toBeVisible();

  // The workspace's owner now sees the Free plan.
  await signIn(page, "owner@globex.test");
  await page.goto("/en/w/globex/billing");
  await expect(page.getByTestId("plan-name")).toHaveText("Free");

  // Suspension: members cannot reach the workspace until it is restored.
  await signIn(page, "operator@platform.test");
  await page.goto("/en/admin");
  await page
    .getByTestId("workspace-globex")
    .getByRole("button", { name: "Suspend workspace" })
    .click();
  await expect(
    page.getByTestId("workspace-globex").getByRole("button", { name: "Restore workspace" }),
  ).toBeVisible();
  await signIn(page, "owner@globex.test");
  expect((await page.goto("/en/w/globex"))?.status()).toBe(404);

  await signIn(page, "operator@platform.test");
  await page.goto("/en/admin");
  await page
    .getByTestId("workspace-globex")
    .getByRole("button", { name: "Restore workspace" })
    .click();
  await expect(
    page.getByTestId("workspace-globex").getByRole("button", { name: "Suspend workspace" }),
  ).toBeVisible();
  await signIn(page, "owner@globex.test");
  expect((await page.goto("/en/w/globex"))?.status()).toBe(200);
});
