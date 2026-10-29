import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

const local = (daysAhead: number, hour: number) => {
  const date = new Date(Date.now() + daysAhead * 86_400_000);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString().slice(0, 16);
};

test("schedule: invite, conflict protection, response and cancellation", async ({
  page,
  browser,
}) => {
  await signIn(page, "owner@acme.test");
  await page.goto("/en/w/acme/schedule");
  await page.getByLabel("Title", { exact: true }).fill("Quarterly review");
  await page.getByLabel("Start (UTC)", { exact: true }).fill(local(3, 10));
  await page.getByLabel("Location or link").fill("Room 4");
  await page.getByLabel("Acme Viewer").check();
  await page.getByRole("button", { name: "Schedule meeting" }).click();
  await expect(page.getByText("Quarterly review")).toBeVisible();
  await expect(page.getByText(/Acme Viewer \(pending\)/)).toBeVisible();

  // The same slot cannot be booked twice.
  await page.getByLabel("Title", { exact: true }).fill("Clashing meeting");
  await page.getByLabel("Start (UTC)", { exact: true }).fill(local(3, 10));
  await page.getByRole("button", { name: "Schedule meeting" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "conflicts" })).toBeVisible();
  await expect(page.getByText("Clashing meeting")).toHaveCount(0);

  // The viewer sees the invitation (read-only role), is notified, and accepts.
  const viewerContext = await browser.newContext();
  const viewer = await viewerContext.newPage();
  await signIn(viewer, "viewer@acme.test");
  await viewer.goto("/en/w/acme/notifications");
  await expect(viewer.getByText(/Acme Owner invited you to “Quarterly review”/)).toBeVisible();
  await viewer.goto("/en/w/acme/schedule");
  await expect(viewer.getByText("Quarterly review")).toBeVisible();
  await expect(viewer.getByText("New meeting")).toHaveCount(0);
  await viewer.getByRole("button", { name: "Accept" }).click();
  await page.reload();
  await expect(page.getByText(/Acme Viewer \(accepted\)/)).toBeVisible();

  // Cancelling removes it for both.
  await page.getByRole("button", { name: "Cancel meeting" }).click();
  await expect(page.getByText("Quarterly review")).toHaveCount(0);
  await viewer.reload();
  await expect(viewer.getByText("Quarterly review")).toHaveCount(0);
  await viewerContext.close();
});

test("another tenant cannot reach acme's schedule", async ({ page }) => {
  await signIn(page, "owner@globex.test");
  expect((await page.goto("/en/w/acme/schedule"))?.status()).toBe(404);
});
