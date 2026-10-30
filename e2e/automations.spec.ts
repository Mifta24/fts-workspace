import { PrismaPg } from "@prisma/adapter-pg";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "../src/generated/prisma/client";
import { E2E_DATABASE_URL } from "./e2e-env";
import { signIn } from "./helpers";

// The follow-up task would make acme's dashboard non-empty for the tests that run later, and the
// rules must be off again: put the shared database back whatever happens.
test.afterEach(async () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: E2E_DATABASE_URL }),
  });
  try {
    const acme = await prisma.organization.findUniqueOrThrow({ where: { slug: "acme" } });
    await prisma.notification.deleteMany({
      where: { organizationId: acme.id, resourceType: "task" },
    });
    await prisma.task.deleteMany({
      where: { organizationId: acme.id, title: "Follow up: Automation survey" },
    });
    await prisma.automationRule.deleteMany({ where: { organizationId: acme.id } });
  } finally {
    await prisma.$disconnect();
  }
});

const rule = (page: Page, title: string) =>
  page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: title }) });

test("automations: off by default, owners and admins turn rules on, and a form submission is followed up", async ({
  page,
  browser,
}) => {
  const NOTIFY = "Tell the form owner about new submissions";
  const TASK = "Create a follow-up task for each submission";

  // Everyone else has no such page, and it sits in the full navigation only.
  await signIn(page, "viewer@acme.test");
  expect((await page.goto("/en/w/acme/automations"))?.status()).toBe(404);

  await signIn(page, "owner@acme.test");
  await page.goto("/en/w/acme");
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav.getByRole("link", { name: "Automations", exact: true })).toHaveCount(0);
  await nav.getByRole("button", { name: "Show all features" }).click();
  await nav.getByRole("link", { name: "Automations", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Automations", level: 1 })).toBeVisible();
  await expect(rule(page, NOTIFY).getByText("Off", { exact: true })).toBeVisible();
  await expect(rule(page, TASK).getByText("Off", { exact: true })).toBeVisible();

  // Turn two rules on.
  await rule(page, NOTIFY).getByRole("button", { name: "Turn on" }).click();
  await expect(rule(page, NOTIFY).getByText("On", { exact: true })).toBeVisible();
  await rule(page, TASK).getByRole("button", { name: "Turn on" }).click();
  await expect(rule(page, TASK).getByText("On", { exact: true })).toBeVisible();

  // A form is published and a visitor with no account fills it in.
  await page.goto("/en/w/acme/forms");
  await page.getByLabel("Title", { exact: true }).fill("Automation survey");
  await page.getByRole("button", { name: "Create form" }).click();
  await expect(page).toHaveURL(/\/forms\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Publish" }).click();
  const publicUrl = (await page.getByTestId("public-url").textContent())!.trim();
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.goto(publicUrl);
  await visitor.getByLabel(/Your name/).fill("Auto Visitor");
  await visitor.getByLabel(/Email/).fill("auto@visitor.test");
  await visitor.getByLabel(/How can we help/).fill("A secret question about pricing");
  await visitor.getByLabel(/I agree that you may store these details/).check();
  await visitor.getByRole("button", { name: "Submit" }).click();
  await expect(visitor.getByText("Thank you! Your answers were sent.")).toBeVisible();
  await visitorContext.close();

  // The worker follows up within a few seconds: a notification for the form's owner...
  await expect(async () => {
    await page.goto("/en/w/acme/notifications");
    await expect(page.getByText("New submission on “Automation survey”")).toBeVisible({
      timeout: 1_000,
    });
  }).toPass({ timeout: 30_000 });
  // ...and a task that holds the form's name but nothing the visitor wrote.
  await page.goto("/en/w/acme/tasks");
  await expect(page.getByRole("link", { name: "Follow up: Automation survey" })).toBeVisible();
  await expect(page.getByText("secret question")).toHaveCount(0);

  // Switch them off again so later runs start clean.
  await page.goto("/en/w/acme/automations");
  await rule(page, NOTIFY).getByRole("button", { name: "Turn off" }).click();
  await expect(rule(page, NOTIFY).getByText("Off", { exact: true })).toBeVisible();
  await rule(page, TASK).getByRole("button", { name: "Turn off" }).click();
  await expect(rule(page, TASK).getByText("Off", { exact: true })).toBeVisible();
});
