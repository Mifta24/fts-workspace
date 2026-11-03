import { expect, type Page } from "@playwright/test";
import { totpFromSecret } from "../tests/helpers/totp";
import { E2E_OPERATOR_TOTP_SECRET, E2E_PASSWORD } from "./e2e-env";

export async function signIn(page: Page, email: string) {
  await page.goto("/en/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // Operators have two-step sign-in: a code is asked for after the password.
  const code = page.getByLabel("Code from the app");
  const next = await Promise.race([
    page.waitForURL(/\/en\/workspaces$/).then(() => "done" as const),
    code.waitFor().then(() => "code" as const),
  ]);
  if (next === "code") {
    await code.fill(totpFromSecret(E2E_OPERATOR_TOTP_SECRET));
    await page.getByRole("button", { name: "Verify" }).click();
  }
  await expect(page).toHaveURL(/\/en\/workspaces$/);
}
