import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("forms: publish, anonymous submission with consent, contact creation and closing", async ({
  page,
  browser,
}) => {
  await signIn(page, "owner@acme.test");
  await page.goto("/en/w/acme/forms");
  await page.getByLabel("Title", { exact: true }).fill("Ask us anything");
  await page.getByRole("button", { name: "Create form" }).click();
  await expect(page).toHaveURL(/\/forms\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Not public yet")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  const publicUrl = (await page.getByTestId("public-url").textContent())!.trim();
  expect(publicUrl).toMatch(/\/en\/f\/[A-Za-z0-9_-]{22}$/);

  // A visitor with no account fills it in.
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.goto(publicUrl);
  await expect(visitor.getByRole("heading", { name: "Ask us anything", level: 1 })).toBeVisible();
  await expect(visitor.getByRole("link", { name: "Projects" })).toHaveCount(0);
  await visitor.getByLabel(/Your name/).fill("Pat Visitor");
  await visitor.getByLabel(/Email/).fill("pat@visitor.test");
  await visitor.getByLabel(/How can we help/).fill("Do you offer onsite training?");
  // The consent box is required before anything is sent.
  await visitor.getByRole("button", { name: "Submit" }).click();
  await expect(visitor.getByRole("heading", { name: "Ask us anything" })).toBeVisible();
  await expect(visitor.getByText("Thank you!")).toHaveCount(0);
  await visitor.getByLabel(/I agree that you may store these details/).check();
  await visitor.getByRole("button", { name: "Submit" }).click();
  await expect(visitor.getByText("Thank you! Your answers were sent.")).toBeVisible();

  // The team sees the answers and the new CRM contact with consent on record.
  await page.reload();
  await expect(page.getByText("Do you offer onsite training?")).toBeVisible();
  await expect(page.getByText(/linked to a CRM contact/)).toBeVisible();
  await page.goto("/en/w/acme/crm?q=pat%40visitor");
  await page.getByRole("link", { name: "Pat Visitor" }).click();
  await expect(page.getByText("Current status: Granted")).toBeVisible();
  await expect(page.getByText(/form: Ask us anything/)).toBeVisible();

  // Closing the form makes the link stop working.
  await page.goBack();
  await page.goBack();
  await page.getByRole("button", { name: "Close form" }).click();
  await expect(page.getByText(/The link no longer works/)).toBeVisible();
  expect((await visitor.goto(publicUrl))?.status()).toBe(404);
  await visitorContext.close();
});

test("only managers see forms, and unknown public links are 404", async ({ page }) => {
  await signIn(page, "viewer@acme.test");
  await page.goto("/en/w/acme");
  await expect(page.getByRole("link", { name: "Forms" })).toHaveCount(0);
  expect((await page.goto("/en/w/acme/forms"))?.status()).toBe(404);
  expect((await page.goto(`/en/f/${"a".repeat(22)}`))?.status()).toBe(404);
});

test("forms: fields are edited while drafting, templates follow the language, labels only after publishing", async ({
  page,
  browser,
}) => {
  await signIn(page, "owner@acme.test");
  await page.goto("/ja/w/acme/forms");
  await page.locator("#f-template").selectOption("feedback");
  await page.locator("#f-title").fill("満足度アンケート");
  await page
    .locator("form")
    .filter({ has: page.locator("#f-title") })
    .getByRole("button")
    .last()
    .click();
  await expect(page).toHaveURL(/\/forms\/[0-9a-f-]{36}$/);
  // The template's wording was copied in Japanese.
  await expect(page.getByLabel("ラベル").first()).toHaveValue("満足度を教えてください");

  await page.getByRole("button", { name: "項目を追加" }).click();
  await page.getByLabel("ラベル").last().fill("ご意見をどうぞ");
  await page.getByRole("button", { name: "項目を保存" }).click();
  await expect(page.getByLabel("ラベル")).toHaveCount(3);

  await page.goto(page.url().replace("/ja/", "/en/"));
  await page.getByRole("button", { name: "Publish" }).click();
  const publicUrl = (await page.getByTestId("public-url").textContent())!.trim();
  await expect(page.getByRole("button", { name: "Add field" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);

  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.goto(publicUrl);
  await expect(visitor.getByLabel(/ご意見をどうぞ/)).toBeVisible();
  await visitorContext.close();
});
