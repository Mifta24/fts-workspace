import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("chat: channels, messages, DMs, inbox and read-only viewers", async ({ page, browser }) => {
  await signIn(page, "owner@acme.test");

  // Public channel with a message that can be edited.
  await page.goto("/en/w/acme/chat");
  await page.getByLabel("Channel name").fill("e2e-room");
  await page.getByRole("button", { name: "Create channel" }).click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: "# e2e-room" })).toBeVisible();
  await page.getByLabel("Message", { exact: true }).fill("Hello from the owner");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Hello from the owner")).toBeVisible();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Edit message").fill("Hello, edited");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Hello, edited")).toBeVisible();
  await expect(page.getByText(/UTC · edited/)).toBeVisible();

  // A private channel exists but is invisible to others.
  await page.goto("/en/w/acme/chat");
  await page.getByLabel("Channel name").fill("e2e-secret");
  await page.getByLabel("Private channel (invite only)").check();
  await page.getByRole("button", { name: "Create channel" }).click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  const privateUrl = page.url();

  // A viewer can join the public channel and read, but cannot post, and cannot see the private one.
  const viewerContext = await browser.newContext();
  const viewer = await viewerContext.newPage();
  await signIn(viewer, "viewer@acme.test");
  await viewer.goto("/en/w/acme/chat");
  await expect(viewer.getByText("e2e-secret")).toHaveCount(0);
  await viewer.getByRole("button", { name: "Join" }).click();
  await expect(viewer).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  await expect(viewer.getByText("Hello, edited")).toBeVisible();
  await expect(viewer.getByText("You can read this conversation but not post.")).toBeVisible();
  await expect(viewer.getByRole("button", { name: "Send" })).toHaveCount(0);
  const response = await viewer.goto(privateUrl);
  expect(response?.status()).toBe(404);

  // Direct message from the owner shows up in the viewer's inbox.
  await page.goto("/en/w/acme/members");
  await page
    .getByRole("listitem")
    .filter({ hasText: "Acme Viewer" })
    .getByRole("button", { name: "Message" })
    .click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Acme Viewer" })).toBeVisible();
  await page.getByLabel("Message", { exact: true }).fill("Private hello");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Private hello")).toBeVisible();

  await viewer.goto("/en/w/acme/notifications");
  await expect(viewer.getByText("Acme Owner sent you a message")).toBeVisible();
  await viewer.getByRole("button", { name: "Mark all as read" }).click();
  await expect(viewer.getByText("unread", { exact: true })).toHaveCount(0);
  await viewerContext.close();
});

test("another tenant's owner cannot reach acme chat", async ({ page }) => {
  await signIn(page, "owner@globex.test");
  const response = await page.goto("/en/w/acme/chat");
  expect(response?.status()).toBe(404);
});
