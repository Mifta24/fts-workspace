import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("booking: publish a page, a visitor books a slot, the owner sees it, closing stops the link", async ({
  page,
  browser,
}) => {
  await signIn(page, "owner@acme.test");
  await page.goto("/en/w/acme/schedule");
  await page.getByRole("link", { name: "Booking pages" }).click();
  // The schedule page has a "Title" field too: wait until the navigation has finished.
  await expect(page.getByRole("heading", { name: "Booking pages", level: 1 })).toBeVisible();
  await page.getByLabel("Title", { exact: true }).fill("Intro call");
  await page.getByRole("button", { name: "Create booking page" }).click();
  await expect(page).toHaveURL(/\/booking\/[0-9a-f-]{36}$/);
  await expect(page.getByText(/Not public yet/)).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  const publicUrl = (await page.getByTestId("public-url").textContent())!.trim();
  expect(publicUrl).toMatch(/\/en\/b\/[A-Za-z0-9_-]{22}$/);

  // A visitor with no account books the first free slot.
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.goto(publicUrl);
  await expect(visitor.getByRole("heading", { name: "Intro call", level: 1 })).toBeVisible();
  await expect(visitor.getByRole("link", { name: "Projects" })).toHaveCount(0);
  await visitor.locator('input[name="startsAt"]').first().check({ force: true });
  await visitor.getByLabel("Your name").fill("Pat Booker");
  await visitor.getByLabel("Email").fill("pat@booker.test");
  // The consent box is required before anything is sent.
  await visitor.getByRole("button", { name: "Book this time" }).click();
  await expect(visitor.getByText(/You are booked for/)).toHaveCount(0);
  await visitor.getByLabel(/I agree that you may store these details/).check();
  await visitor.getByRole("button", { name: "Book this time" }).click();
  await expect(visitor.getByText(/You are booked for .* \(UTC\)\. Thank you!/)).toBeVisible();

  // The owner sees the meeting, linked to a new CRM contact with consent on record.
  await page.goto("/en/w/acme/schedule");
  await expect(page.getByText("Intro call").first()).toBeVisible();
  await expect(page.getByText("About Pat Booker")).toBeVisible();
  await page.goto("/en/w/acme/crm?q=pat%40booker");
  await page.getByRole("link", { name: "Pat Booker" }).click();
  await expect(page.getByText("Current status: Granted")).toBeVisible();
  await expect(page.getByText(/booking: Intro call/)).toBeVisible();
  await expect(page.getByText("Current stage: Lead")).toBeVisible();

  // The booked slot is gone for the next visitor, and closing the page ends the link.
  await visitor.reload();
  await expect(visitor.getByRole("heading", { name: "Intro call", level: 1 })).toBeVisible();
  await page.goto("/en/w/acme/booking");
  await page.getByRole("link", { name: "Intro call" }).click();
  await page.getByRole("button", { name: "Close page" }).click();
  await expect(page.getByText(/The link no longer works/)).toBeVisible();
  expect((await visitor.goto(publicUrl))?.status()).toBe(404);
  await visitorContext.close();

  // Leave the schedule as it was found: the booked meeting is the owner's to cancel.
  await page.goto("/en/w/acme/schedule");
  await page.getByRole("button", { name: "Cancel meeting" }).click();
  await expect(page.getByText("Intro call")).toHaveCount(0);
});

test("booking: viewers have no booking pages, and unknown public links are 404", async ({
  page,
}) => {
  await signIn(page, "viewer@acme.test");
  await page.goto("/en/w/acme/schedule");
  await expect(page.getByRole("link", { name: "Booking pages" })).toHaveCount(0);
  expect((await page.goto("/en/w/acme/booking"))?.status()).toBe(404);
  expect((await page.goto(`/en/b/${"a".repeat(22)}`))?.status()).toBe(404);
});
