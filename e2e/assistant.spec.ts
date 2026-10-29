import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// Uses the globex tenant so budget changes never touch the acme assertions.
test("the assistant is disabled without configuration and admins manage the AI budget", async ({
  page,
}) => {
  await signIn(page, "owner@globex.test");
  await page.goto("/en/w/globex/assistant");
  await expect(page.getByRole("heading", { name: "Assistant", level: 1 })).toBeVisible();
  await expect(page.getByText(/not configured for this deployment/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask" })).toHaveCount(0);
  await expect(page.getByText(/0 of 200,000 tokens used today/)).toBeVisible();

  await page.getByLabel(/Daily token budget/).fill("50000");
  await page.getByRole("button", { name: "Save budget" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page.getByText(/0 of 50,000 tokens used today/)).toBeVisible();
  await page.getByLabel(/Daily token budget/).fill("200000");
  await page.getByRole("button", { name: "Save budget" }).click();
  await expect(page.getByText(/0 of 200,000 tokens used today/)).toBeVisible();
});

test("viewers have no access to the assistant", async ({ page }) => {
  await signIn(page, "viewer@acme.test");
  const response = await page.goto("/en/w/acme/assistant");
  expect(response?.status()).toBe(404);
});
