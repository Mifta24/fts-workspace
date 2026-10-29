import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("crm: contact, consent, deal, activity, pipeline report and erasure", async ({ page }) => {
  await signIn(page, "owner@acme.test");
  await page.goto("/en/w/acme/crm");
  await page.getByLabel("Name", { exact: true }).fill("Dana Customer");
  await page.getByLabel("Email", { exact: true }).fill("dana@customer.test");
  await page.getByLabel("Company").fill("Customer Inc");
  await page.getByLabel("Consent to be contacted").selectOption("GRANTED");
  await page.getByLabel("How consent was given").fill("signed form");
  await page.getByRole("button", { name: "Add contact" }).click();
  await expect(page).toHaveURL(/\/crm\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Dana Customer", level: 1 })).toBeVisible();
  await expect(page.getByText("Current status: Granted")).toBeVisible();
  await expect(page.getByText(/Granted · signed form/)).toBeVisible();

  // Withdrawing consent is recorded with its basis.
  await page.getByLabel("Consent to be contacted").selectOption("WITHDRAWN");
  await page.getByLabel("How consent was given").fill("email reply");
  await page.getByRole("button", { name: "Record decision" }).click();
  await expect(page.getByText("Current status: Withdrawn")).toBeVisible();

  // A deal moves to Won; the activity is logged.
  await page.getByLabel("Deal title").fill("Annual plan");
  await page.getByLabel("Amount").fill("1200");
  await page.getByRole("button", { name: "Add deal" }).click();
  await expect(page.getByText(/Lead · 1,200\.00 USD/)).toBeVisible();
  await page.getByLabel("Stage of Annual plan").selectOption("WON");
  await page.getByRole("button", { name: "Move" }).click();
  await expect(page.getByText(/Won · 1,200\.00 USD/)).toBeVisible();
  await page.getByLabel("What happened").fill("Signed the contract by phone");
  await page.getByRole("button", { name: "Add activity" }).click();
  await expect(page.getByText("Signed the contract by phone")).toBeVisible();

  // The pipeline report counts the win without mixing currencies.
  await page.goto("/en/w/acme/crm/pipeline");
  await expect(page.locator("dt:has-text('Won') + dd").first()).toHaveText("1");
  await expect(page.getByText("1,200.00 USD").first()).toBeVisible();
  await expect(page.locator("dt:has-text('Win rate') + dd")).toHaveText("100%");

  // Erasure removes the personal data but keeps the deal and the consent history.
  await page.getByRole("link", { name: "Back" }).click();
  await page.getByRole("link", { name: "Dana Customer" }).click();
  await expect(page).toHaveURL(/\/crm\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Erase personal data" }).click();
  await expect(page.getByRole("heading", { name: "Erased contact", level: 1 })).toBeVisible();
  await expect(page.getByText(/personal data was erased/)).toBeVisible();
  await expect(page.getByText("Signed the contract by phone")).toHaveCount(0);
  await expect(page.getByText("Customer Inc")).toHaveCount(0);
  await expect(page.getByText(/Won · 1,200\.00 USD/)).toBeVisible();
  await expect(page.getByText(/Withdrawn · email reply/)).toBeVisible();
});

test("viewers and other tenants have no access to the CRM", async ({ page, browser }) => {
  await signIn(page, "viewer@acme.test");
  await page.goto("/en/w/acme");
  await expect(page.getByRole("link", { name: "CRM" })).toHaveCount(0);
  expect((await page.goto("/en/w/acme/crm"))?.status()).toBe(404);

  const other = await browser.newContext();
  const outsider = await other.newPage();
  await signIn(outsider, "owner@globex.test");
  expect((await outsider.goto("/en/w/acme/crm"))?.status()).toBe(404);
  await other.close();
});
