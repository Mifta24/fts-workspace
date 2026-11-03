import { expect, test } from "@playwright/test";
import { totpFromBase32Key } from "../tests/helpers/totp";
import { E2E_PASSWORD } from "./e2e-env";
import { signIn } from "./helpers";

test("two-step sign-in: an operator without it is sent to turn it on, then reaches the console", async ({
  page,
}) => {
  // No code step for this account yet.
  await signIn(page, "nomfa-operator@platform.test");

  await page.goto("/en/admin");
  await expect(page).toHaveURL(/\/en\/security\?required=operator$/);
  await expect(page.getByTestId("mfa-required")).toBeVisible();
  await expect(page.getByTestId("mfa-status")).toHaveText("Two-step sign-in is off.");

  // Turning it on: password, then the first code from the app.
  await page.getByLabel("Your password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Turn on" }).click();
  const key = (await page.getByTestId("totp-key").textContent())?.trim() ?? "";
  expect(key.length).toBeGreaterThan(10);
  await expect(page.getByTestId("recovery-codes").getByRole("listitem").first()).toBeVisible();
  await page.getByLabel("Code from the app").fill(totpFromBase32Key(key));
  await page.getByRole("button", { name: "Confirm and turn on" }).click();
  await expect(page.getByTestId("mfa-status")).toHaveText("Two-step sign-in is on.");

  await page.goto("/en/admin");
  await expect(page.getByRole("heading", { name: "Operator console", level: 1 })).toBeVisible();
});

test("two-step sign-in: someone who is not an operator still gets a plain 404", async ({
  page,
}) => {
  await signIn(page, "owner@acme.test");
  expect((await page.goto("/en/admin"))?.status()).toBe(404);
});

test("two-step sign-in: a wrong code does not sign in", async ({ page }) => {
  await page.goto("/en/sign-in");
  await page.getByLabel("Email").fill("operator@platform.test");
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Code from the app").fill("000000");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText("That code is not valid. Try again.")).toBeVisible();
  expect((await page.goto("/en/admin"))?.status()).toBe(404);
});
