import { createHash, randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "../src/generated/prisma/client";
import { E2E_DATABASE_URL } from "./e2e-env";
import { signIn } from "./helpers";

test("an admin invites someone who joins with the emailed link", async ({ page, browser }) => {
  await signIn(page, "owner@acme.test");
  await page.goto("/en/w/acme/members");
  await page.getByLabel("Email").fill("someone-new@acme.test");
  await page.getByLabel("Role").selectOption({ label: "Viewer" });
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText("Invitation sent.")).toBeVisible();
  await expect(page.getByText("someone-new@acme.test")).toBeVisible();

  // Revoking removes it from the pending list.
  await page.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("someone-new@acme.test")).toHaveCount(0);

  // The email itself goes to the server log; here an invitation with a known token is stored
  // directly, the way the service stores it (hash only).
  const token = randomBytes(32).toString("base64url");
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: E2E_DATABASE_URL }),
  });
  try {
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: "owner@acme.test" } });
    const organization = await prisma.organization.findUniqueOrThrow({ where: { slug: "acme" } });
    await prisma.invitation.create({
      data: {
        organizationId: organization.id,
        email: "invitee@acme.test",
        role: "MEMBER",
        tokenHash: createHash("sha256").update(token).digest("hex"),
        invitedById: owner.id,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
  } finally {
    await prisma.$disconnect();
  }

  // Anonymous visitors see the invitation and are asked to sign in.
  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await guestPage.goto(`/en/invite/${token}`);
  await expect(guestPage.getByRole("heading", { name: "Join acme workspace" })).toBeVisible();
  await expect(guestPage.getByText(/i\*\*\*@acme\.test/)).toBeVisible();
  await expect(guestPage.getByRole("link", { name: "Sign in" })).toBeVisible();
  await guest.close();

  // The wrong account cannot use it.
  const wrong = await browser.newContext();
  const wrongPage = await wrong.newPage();
  await signIn(wrongPage, "viewer@acme.test");
  await wrongPage.goto(`/en/invite/${token}`);
  await wrongPage.getByRole("button", { name: "Accept invitation" }).click();
  await expect(wrongPage.locator('form [role="alert"]')).toContainText(
    "You do not have permission",
  );
  await wrong.close();

  // The invited account joins and lands in the workspace; the link then stops working.
  const invitee = await browser.newContext();
  const inviteePage = await invitee.newPage();
  await signIn(inviteePage, "invitee@acme.test");
  await inviteePage.goto(`/en/invite/${token}`);
  await inviteePage.getByRole("button", { name: "Accept invitation" }).click();
  await expect(inviteePage).toHaveURL(/\/en\/w\/acme$/);
  await inviteePage.goto("/en/w/acme/members");
  await expect(inviteePage.getByText("Invited Person")).toBeVisible();
  await inviteePage.goto(`/en/invite/${token}`);
  await expect(inviteePage.getByRole("heading", { name: "Invitation unavailable" })).toBeVisible();
  await invitee.close();
});

test("members who cannot invite see the list without email addresses or invite forms", async ({
  page,
}) => {
  await signIn(page, "viewer@acme.test");
  await page.goto("/en/w/acme/members");
  await expect(page.getByRole("heading", { name: "Members", level: 1 })).toBeVisible();
  await expect(page.getByText("Acme Owner")).toBeVisible();
  await expect(page.getByText("owner@acme.test")).toHaveCount(0);
  await expect(page.getByText("Invite someone")).toHaveCount(0);
  await expect(page.getByText("Pending invitations")).toHaveCount(0);
});

test("an unknown invitation token shows the generic unavailable page", async ({ page }) => {
  await page.goto(`/en/invite/${"a".repeat(43)}`);
  await expect(page.getByRole("heading", { name: "Invitation unavailable" })).toBeVisible();
});
