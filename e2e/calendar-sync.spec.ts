import { expect, test } from "@playwright/test";
import { E2E_BASE_URL } from "./e2e-env";
import { signIn } from "./helpers";

const CALLBACK = "/api/integrations/google/callback";

test("google calendar: the consent round trip starts correctly, and refused or forged returns connect nothing", async ({
  page,
  context,
}) => {
  // Google's own screen is stubbed: the test only needs to see what the app asked for.
  await page.route("https://accounts.google.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<p>Google consent screen</p>" }),
  );
  await signIn(page, "owner@acme.test");
  await page.goto("/en/w/acme/booking");
  await expect(page.getByRole("heading", { name: "Google Calendar", level: 2 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Disconnect" })).toHaveCount(0);

  const start = async () => {
    const asked = page.waitForRequest(/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
    await page.getByRole("button", { name: "Connect Google Calendar" }).click();
    const url = new URL((await asked).url());
    // Wait until the browser has actually arrived, so the next navigation does not race it.
    await expect(page.getByText("Google consent screen")).toBeVisible();
    return url;
  };

  const url = await start();
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    client_id: "e2e-client-id.apps.googleusercontent.com",
    redirect_uri: `${E2E_BASE_URL}${CALLBACK}`,
    response_type: "code",
    // Only "when am I busy": never event titles or details.
    scope: "https://www.googleapis.com/auth/calendar.freebusy",
    access_type: "offline",
  });
  const state = url.searchParams.get("state")!;
  expect(state.length).toBeGreaterThanOrEqual(24);

  // The round trip is remembered in a cookie the page's scripts cannot read.
  const cookie = (await context.cookies()).find((item) => item.name === "fts_google_oauth");
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: CALLBACK });
  expect(cookie!.value).not.toContain(state);

  // Saying no on Google's screen connects nothing and says so.
  await page.goto(`${CALLBACK}?error=access_denied&state=${state}`);
  await expect(page).toHaveURL(/\/en\/w\/acme\/booking\?calendar=denied$/);
  await expect(page.getByText(/permission to see when you are busy was not granted/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Disconnect" })).toHaveCount(0);

  // A return that does not carry our state is not trusted, even with a code.
  await start();
  await page.goto(`${CALLBACK}?code=stolen-code&state=forged-state-value-0123456789`);
  await expect(page).toHaveURL(/\/en\/workspaces$/);
  await page.goto("/en/w/acme/booking");
  await expect(page.getByRole("button", { name: "Connect Google Calendar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Disconnect" })).toHaveCount(0);

  // The cookie is single use: the first return used it up.
  await page.goto(`${CALLBACK}?error=access_denied&state=${state}`);
  await expect(page).toHaveURL(/\/en\/workspaces$/);
});

test("google calendar: nobody signed out can finish a connection", async ({ browser }) => {
  const visitor = await browser.newContext();
  const anonymous = await visitor.newPage();
  await anonymous.goto(`${E2E_BASE_URL}${CALLBACK}?code=x&state=y`);
  await expect(anonymous).toHaveURL(/\/en\/sign-in/);
  await visitor.close();
});
