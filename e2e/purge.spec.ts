import { PrismaPg } from "@prisma/adapter-pg";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "../src/generated/prisma/client";
import { E2E_DATABASE_URL } from "./e2e-env";
import { signIn } from "./helpers";

const SLUG = "purge-me";
const DAY = 86_400_000;
const prismaClient = () =>
  new PrismaClient({ adapter: new PrismaPg({ connectionString: E2E_DATABASE_URL }) });

// The seeded workspaces are shared with other specs, so this one works on its own workspace.
async function removeWorkspace() {
  const prisma = prismaClient();
  try {
    const organization = await prisma.organization.findFirst({
      where: { OR: [{ slug: SLUG }, { purgedAt: { not: null } }] },
      select: { id: true },
    });
    if (!organization) return;
    await prisma.auditLog.deleteMany({ where: { organizationId: organization.id } });
    await prisma.member.deleteMany({ where: { organizationId: organization.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
  } finally {
    await prisma.$disconnect();
  }
}

async function createWorkspace(requestedDaysAgo: number) {
  const prisma = prismaClient();
  try {
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: "owner@globex.test" } });
    await prisma.organization.create({
      data: {
        name: "Purge me",
        slug: SLUG,
        deletionRequestedAt: new Date(Date.now() - requestedDaysAgo * DAY),
        members: { create: { userId: owner.id, role: "OWNER" } },
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

test.beforeEach(removeWorkspace);
test.afterEach(removeWorkspace);

test("operator console: a due workspace can be purged, and its members lose access", async ({
  page,
}) => {
  await createWorkspace(15);
  await signIn(page, "operator@platform.test");
  await page.goto(`/en/admin?q=${SLUG}`);
  const card = page.getByTestId(`workspace-${SLUG}`);
  await expect(card.getByTestId(`deletion-${SLUG}`)).toBeVisible();

  await card.getByLabel("Type the workspace address to confirm").fill("not-this");
  await card.getByRole("button", { name: "Remove all data now" }).click();
  await expect(card.getByRole("alert").filter({ hasText: "Check the details" })).toBeVisible();
  await expect(card.getByTestId(`purged-${SLUG}`)).toHaveCount(0);

  await card.getByLabel("Type the workspace address to confirm").fill(` ${SLUG.toUpperCase()} `);
  await card.getByRole("button", { name: "Remove all data now" }).click();
  // The tombstone has a new address, so the old search no longer finds it.
  await expect(card).toHaveCount(0);
  await page.goto("/en/admin?q=deleted-");
  await expect(page.locator("[data-testid^='purged-']").first()).toBeVisible();

  await signIn(page, "owner@globex.test");
  expect((await page.goto(`/en/w/${SLUG}`))?.status()).toBe(404);
});

test("operator console: no purge form while the waiting period runs; others get 404", async ({
  page,
}) => {
  await createWorkspace(1);
  await signIn(page, "operator@platform.test");
  await page.goto(`/en/admin?q=${SLUG}`);
  const card = page.getByTestId(`workspace-${SLUG}`);
  await expect(card.getByTestId(`deletion-${SLUG}`)).toBeVisible();
  await expect(card.getByRole("button", { name: "Remove all data now" })).toHaveCount(0);

  await signIn(page, "owner@globex.test");
  expect((await page.goto("/en/admin"))?.status()).toBe(404);
});
