import { expect, type Page } from "@playwright/test";
import { E2E_PASSWORD } from "./e2e-env";

export async function signIn(page: Page, email: string) {
  await page.goto("/en/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/workspaces$/);
}
