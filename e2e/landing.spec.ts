import { expect, test } from "@playwright/test";

const landingByLocale = [
  { locale: "en", title: "Turn shared goals into steady progress.", signIn: "Sign in" },
  { locale: "id", title: "Ubah tujuan bersama menjadi progres nyata.", signIn: "Masuk" },
  { locale: "ja", title: "チームの目標を、着実な前進につなげる。", signIn: "ログイン" },
] as const;

test("public landing page is complete and fits phone and desktop widths", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: landingByLocale[0].title }),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });

  for (const { locale, title, signIn } of landingByLocale) {
    await page.goto(`/${locale}`);

    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /create an account|buat akun|アカウントを作成/i }).first(),
    ).toHaveAttribute("href", new RegExp(`/${locale}/sign-up$`));
    await expect(page.getByRole("link", { name: signIn, exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: signIn, exact: true })).toHaveAttribute(
      "href",
      new RegExp(`/${locale}/sign-in$`),
    );
    await expect(page.locator("#how-it-works")).toBeAttached();
    await expect(page.locator("#features")).toBeAttached();
    await expect(page.locator("#privacy")).toBeAttached();
    await expect(page.locator("#use-cases")).toBeAttached();
    await expect(page.locator("#getting-started")).toBeAttached();
    await expect(page.locator("#faq")).toBeAttached();
    await expect(page.getByText(/illustrative|contoh ilustrasi|サンプル/i).first()).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasHorizontalOverflow, `${locale} landing page should not overflow horizontally`).toBe(
      false,
    );
  }

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/en");
  await expect(
    page.getByRole("heading", { level: 1, name: landingByLocale[0].title }),
  ).toBeVisible();
  const desktopHasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(
    desktopHasHorizontalOverflow,
    "desktop landing page should not overflow horizontally",
  ).toBe(false);
});
