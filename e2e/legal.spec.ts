import { PrismaPg } from "@prisma/adapter-pg";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "../src/generated/prisma/client";
import { E2E_DATABASE_URL } from "./e2e-env";
import { signIn } from "./helpers";

// The deletion request changes the shared database; clear it whatever happens.
test.afterEach(async () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: E2E_DATABASE_URL }),
  });
  try {
    await prisma.organization.updateMany({
      data: { deletionRequestedAt: null, deletionRequestedBy: null },
    });
  } finally {
    await prisma.$disconnect();
  }
});

const PAGES = [
  { locale: "en", privacy: "Privacy notice", terms: "Terms of use", section: "Your rights" },
  {
    locale: "id",
    privacy: "Pemberitahuan privasi",
    terms: "Ketentuan penggunaan",
    section: "Hak Anda",
  },
  {
    locale: "ja",
    privacy: "プライバシーに関するお知らせ",
    terms: "利用規約",
    section: "あなたの権利",
  },
] as const;

for (const { locale, privacy, terms, section } of PAGES) {
  test(`legal pages (${locale}): privacy notice and terms are public and name the operator`, async ({
    page,
  }) => {
    // Anonymous: no sign-in needed.
    await page.goto(`/${locale}/privacy`);
    await expect(page.getByRole("heading", { level: 1, name: privacy })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 2, name: section })).toBeVisible();
    await expect(page.getByText("Example Operator Ltd").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "privacy@example.test" })).toHaveAttribute(
      "href",
      "mailto:privacy@example.test",
    );
    // No untranslated key leaks onto the page.
    await expect(page.locator("main")).not.toContainText(/Legal\.|privacyDoc|termsDoc/);

    await page.goto(`/${locale}/terms`);
    await expect(page.getByRole("heading", { level: 1, name: terms })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByText("Example Operator Ltd").first()).toBeVisible();
    await expect(page.locator("main")).not.toContainText(/Legal\.|privacyDoc|termsDoc/);
  });
}

test("legal pages: every page links to them, and sign-up asks people to read them", async ({
  page,
}) => {
  await page.goto("/en");
  const footer = page.getByRole("navigation", { name: "Legal" });
  await expect(footer.getByRole("link", { name: "Privacy notice" })).toBeVisible();
  await footer.getByRole("link", { name: "Terms of use" }).click();
  await expect(page).toHaveURL(/\/en\/terms$/);

  await page.goto("/en/sign-up");
  await page.getByRole("main").getByRole("link", { name: "Privacy notice" }).click();
  await expect(page).toHaveURL(/\/en\/privacy$/);
});

test("workspace deletion: only the owner asks, everyone sees it, the owner can cancel", async ({
  page,
}) => {
  await signIn(page, "owner@acme.test");
  await page.goto("/en/w/acme/settings");
  await expect(page.getByRole("heading", { level: 1, name: "Workspace settings" })).toBeVisible();

  // A wrong confirmation changes nothing.
  await page.getByLabel(/Type the workspace address/).fill("not-acme");
  await page.getByRole("button", { name: "Request deletion" }).click();
  await expect(page.getByText("Check the details and try again.")).toBeVisible();
  await expect(page.getByTestId("deletion-pending")).toHaveCount(0);

  await page.getByLabel(/Type the workspace address/).fill("acme");
  await page.getByRole("button", { name: "Request deletion" }).click();
  await expect(page.getByTestId("deletion-pending")).toBeVisible();
  await expect(page.getByTestId("deletion-banner")).toContainText("scheduled for deletion");

  // The workspace keeps working, and a viewer sees the notice but not the settings page.
  await signIn(page, "viewer@acme.test");
  await page.goto("/en/w/acme");
  await expect(page.getByTestId("deletion-banner")).toBeVisible();
  expect((await page.goto("/en/w/acme/settings"))?.status()).toBe(404);

  // An operator sees which workspace is waiting.
  await signIn(page, "operator@platform.test");
  await page.goto("/en/admin");
  await expect(page.getByTestId("deletion-acme")).toContainText("Deletion requested");

  await signIn(page, "owner@acme.test");
  await page.goto("/en/w/acme/settings");
  await page.getByRole("button", { name: "Cancel the deletion" }).click();
  await expect(page.getByTestId("deletion-pending")).toHaveCount(0);
  await page.goto("/en/w/acme");
  await expect(page.getByTestId("deletion-banner")).toHaveCount(0);
});

test("workspace deletion: another tenant's owner cannot open the settings", async ({ page }) => {
  await signIn(page, "owner@globex.test");
  expect((await page.goto("/en/w/acme/settings"))?.status()).toBe(404);
});
