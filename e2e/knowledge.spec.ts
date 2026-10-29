import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("knowledge: a file is indexed by the worker and found only by people who may read it", async ({
  page,
  browser,
}) => {
  await signIn(page, "owner@acme.test");
  await page.goto("/en/w/acme/files");
  await page.getByLabel("File", { exact: true }).setInputFiles({
    name: "handbook.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("Onboarding handbook\n\nThe quokka protocol applies to every new hire."),
  });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByRole("link", { name: "handbook.md" })).toBeVisible();
  await page.getByRole("button", { name: "Add to knowledge" }).click();

  // The background worker picks the job up; the page shows progress until then.
  await page.goto("/en/w/acme/knowledge");
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(/Indexed · 1 passages/)).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });

  await page.getByLabel("Search", { exact: true }).fill("quokka");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("The quokka protocol applies to every new hire.")).toBeVisible();

  // Private file: a viewer finds nothing, and does not see the document either.
  const viewerContext = await browser.newContext();
  const viewer = await viewerContext.newPage();
  await signIn(viewer, "viewer@acme.test");
  await viewer.goto("/en/w/acme/knowledge?q=quokka");
  await expect(viewer.getByText("Nothing found in the files you can read.")).toBeVisible();
  await expect(viewer.getByText("handbook.md")).toHaveCount(0);

  // Sharing with the whole workspace makes it searchable immediately, no re-indexing.
  await page.goto("/en/w/acme/files");
  await page.getByRole("link", { name: "Manage access" }).first().click();
  // The list page has an upload form with the same label; wait for the settings page.
  await expect(page).toHaveURL(/\/files\/[0-9a-f-]{36}$/);
  await page.getByLabel("Who can see it").selectOption({ label: "Everyone in the workspace" });
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Who can see it")).toHaveValue("ORGANIZATION");
  await viewer.goto("/en/w/acme/knowledge?q=quokka");
  await expect(viewer.getByText("The quokka protocol applies to every new hire.")).toBeVisible();

  // Making it private again withdraws it right away.
  await page.getByLabel("Who can see it").selectOption({ label: "Only me" });
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Who can see it")).toHaveValue("PRIVATE");
  await viewer.goto("/en/w/acme/knowledge?q=quokka");
  await expect(viewer.getByText("Nothing found in the files you can read.")).toBeVisible();
  await viewerContext.close();

  // Cleanup so other specs keep a predictable file list.
  await page.goto("/en/w/acme/files");
  await page.getByRole("button", { name: "Delete" }).first().click();
  await expect(page.getByText("handbook.md")).toHaveCount(0);
});

test("another tenant cannot reach acme knowledge", async ({ page }) => {
  await signIn(page, "owner@globex.test");
  const response = await page.goto("/en/w/acme/knowledge");
  expect(response?.status()).toBe(404);
});
