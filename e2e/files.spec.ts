import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("files: upload, private by default, share, download, and link misuse", async ({
  page,
  browser,
}) => {
  await signIn(page, "owner@acme.test");
  await page.goto("/en/w/acme/files");

  // A disallowed type is refused.
  await page.getByLabel("File", { exact: true }).setInputFiles({
    name: "page.html",
    mimeType: "text/html",
    buffer: Buffer.from("<script>alert(1)</script>"),
  });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText(/cannot be stored/)).toBeVisible();

  // A text file is accepted and private by default.
  await page.getByLabel("File", { exact: true }).setInputFiles({
    name: "e2e-notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("secret meeting notes"),
  });
  await page.getByRole("button", { name: "Upload" }).click();
  const link = page.getByRole("link", { name: "e2e-notes.txt" });
  await expect(link).toBeVisible();
  await expect(page.getByText(/Only me/).first()).toBeVisible();
  const signedPath = await link.getAttribute("href");
  expect(signedPath).toMatch(/^\/api\/files\/[0-9a-f-]{36}\/content\?org=acme&exp=\d+&sig=/);

  // The owner downloads it as an attachment.
  const download = await page.request.get(signedPath!);
  expect(download.status()).toBe(200);
  expect(await download.text()).toBe("secret meeting notes");
  expect(download.headers()["content-disposition"]).toContain("attachment");
  expect(download.headers()["x-content-type-options"]).toBe("nosniff");

  // Nobody else sees it, and the owner's signed link is useless to them.
  const viewerContext = await browser.newContext();
  const viewer = await viewerContext.newPage();
  await signIn(viewer, "viewer@acme.test");
  await viewer.goto("/en/w/acme/files");
  await expect(viewer.getByText("e2e-notes.txt")).toHaveCount(0);
  expect((await viewer.request.get(signedPath!)).status()).toBe(404);
  const anonymous = await browser.newContext();
  expect((await anonymous.request.get(`http://localhost:3100${signedPath}`)).status()).toBe(401);
  await anonymous.close();

  // After sharing, the viewer sees it and can download it with their own signed link.
  await page.getByRole("link", { name: "Manage access" }).first().click();
  await expect(page).toHaveURL(/\/files\/[0-9a-f-]{36}$/);
  await page.getByLabel("Share with").selectOption({ label: "Acme Viewer" });
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Acme Viewer" })).toBeVisible();

  await viewer.goto("/en/w/acme/files");
  const viewerLink = viewer.getByRole("link", { name: "e2e-notes.txt" });
  await expect(viewerLink).toBeVisible();
  const viewerDownload = await viewer.request.get((await viewerLink.getAttribute("href"))!);
  expect(await viewerDownload.text()).toBe("secret meeting notes");
  // A viewer cannot upload or manage.
  await expect(viewer.getByText("Upload a file")).toHaveCount(0);
  await expect(viewer.getByRole("link", { name: "Manage access" })).toHaveCount(0);
  await viewerContext.close();

  // Deleting removes it for good.
  await page.goto("/en/w/acme/files");
  await page.getByRole("button", { name: "Delete" }).first().click();
  await expect(page.getByText("e2e-notes.txt")).toHaveCount(0);
  expect((await page.request.get(signedPath!)).status()).toBe(404);
});

test("another tenant cannot reach acme files", async ({ page }) => {
  await signIn(page, "owner@globex.test");
  const response = await page.goto("/en/w/acme/files");
  expect(response?.status()).toBe(404);
});
