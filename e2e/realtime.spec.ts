import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("messages and notifications arrive live, without reloading", async ({ page, browser }) => {
  await signIn(page, "owner@acme.test");
  await page.goto("/en/w/acme/chat");
  await page.getByLabel("Channel name").fill("live-room");
  await page.getByRole("button", { name: "Create channel" }).click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);

  const viewerContext = await browser.newContext();
  const viewer = await viewerContext.newPage();
  await signIn(viewer, "viewer@acme.test");
  await viewer.goto("/en/w/acme/chat");
  await viewer
    .getByRole("listitem")
    .filter({ hasText: "live-room" })
    .getByRole("button", { name: "Join" })
    .click();
  await expect(viewer).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);

  // Posted by the owner; the viewer's open page updates by itself.
  await page.getByLabel("Message", { exact: true }).fill("This should appear live");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(viewer.getByText("This should appear live")).toBeVisible({ timeout: 15_000 });

  // A notification raises the inbox badge on a page that is already open.
  await viewer.goto("/en/w/acme/tasks");
  await expect(viewer.getByRole("link", { name: "Inbox" })).toBeVisible();
  await page.goto("/en/w/acme/tasks");
  await page.getByLabel("Task title").fill("Live assignment");
  await page.getByLabel("Assignee").selectOption({ label: "Acme Viewer" });
  await page.getByRole("button", { name: "Create task" }).click();
  await expect(viewer.getByRole("link", { name: /Inbox.*1/ })).toBeVisible({ timeout: 15_000 });
  await viewerContext.close();
});
