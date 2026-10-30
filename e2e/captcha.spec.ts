import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * Opt-in: `E2E_CAPTCHA=pass pnpm test:e2e e2e/captcha.spec.ts` (and `fail`). It talks to
 * Cloudflare with their documented dummy keys, so it needs internet and is skipped otherwise.
 */
const mode = process.env.E2E_CAPTCHA;
test.skip(mode !== "pass" && mode !== "fail", "set E2E_CAPTCHA=pass or fail to run");

test(`captcha (${mode}): the public form is protected by Turnstile`, async ({ page, browser }) => {
  await signIn(page, "owner@acme.test");
  await page.goto("/en/w/acme/forms");
  await page.locator("#f-template").selectOption("feedback");
  await page.locator("#f-title").fill("Captcha feedback");
  await page
    .locator("form")
    .filter({ has: page.locator("#f-title") })
    .getByRole("button")
    .last()
    .click();
  await expect(page).toHaveURL(/\/forms\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Publish" }).click();
  const publicUrl = (await page.getByTestId("public-url").textContent())!.trim();

  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.goto(publicUrl);
  // The widget adds its token field once it has solved the challenge.
  await expect(visitor.locator('input[name="cf-turnstile-response"]')).not.toHaveValue("", {
    timeout: 30_000,
  });
  await visitor.getByLabel(/How would you rate us/).selectOption("5");
  await visitor.getByRole("button", { name: "Submit" }).click();
  if (mode === "pass") {
    await expect(visitor.getByText("Thank you! Your answers were sent.")).toBeVisible();
  } else {
    await expect(visitor.getByRole("alert").filter({ hasText: "verification" })).toBeVisible();
    await expect(visitor.getByText("Thank you!")).toHaveCount(0);
  }
  await visitorContext.close();
});
