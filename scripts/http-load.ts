/**
 * HTTP load test against a running instance: `BASE_URL=https://staging.example pnpm test:load:http`
 *   BASE_URL          target (default http://localhost:3000)
 *   CONCURRENCY       parallel requests (default 20)
 *   REQUESTS          total requests per path (default 400)
 *   PATHS             comma-separated paths (default /api/health,/en/sign-in)
 *   P95_BUDGET_MS     fail when a path's p95 is above this (default 1500)
 *   MAX_ERROR_RATE    fail when more than this share of requests fail (default 0.01)
 *   LOAD_EMAILS       comma-separated accounts to sign in as (optional); requests then carry a session
 *                     cookie, rotating over the accounts, and PATHS should be signed-in pages such as
 *                     /en/w/acme/tasks. Needs LOAD_PASSWORD, the same password for every account
 *
 * It only reads: GETs, plus one sign-in per account at the start. It writes nothing else. With
 * accounts, a 4xx/5xx answer or a redirect to the sign-in page counts as a failure, because the
 * session was not accepted. Point it at staging, never at a shared production system without
 * agreement (the sign-in is rate limited in production). Against `next dev` the numbers describe
 * the dev server, not production capacity. Exits non-zero when a budget is missed.
 */
export {};

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 20);
const REQUESTS = Number(process.env.REQUESTS ?? 400);
const PATHS = (process.env.PATHS ?? "/api/health,/en/sign-in").split(",").map((p) => p.trim());
const EMAILS = (process.env.LOAD_EMAILS ?? "")
  .split(",")
  .map((email) => email.trim())
  .filter(Boolean);
const PASSWORD = process.env.LOAD_PASSWORD ?? "";
const P95_BUDGET_MS = Number(process.env.P95_BUDGET_MS ?? 1500);
const MAX_ERROR_RATE = Number(process.env.MAX_ERROR_RATE ?? 0.01);

/** One sign-in per account; returns the cookie header to send with each later request. */
async function signIn(email: string): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE_URL },
    body: JSON.stringify({ email, password: PASSWORD }),
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  if (!response.ok || !cookie)
    throw new Error(`Sign-in failed for ${email} (HTTP ${response.status})`);
  return cookie;
}

const percentile = (sorted: number[], p: number) =>
  sorted.length === 0
    ? 0
    : sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;

async function run(path: string, cookies: string[]) {
  const durations: number[] = [];
  let failures = 0;
  let next = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < REQUESTS) {
        next += 1;
        const t0 = performance.now();
        try {
          const cookie = cookies.length > 0 ? cookies[next % cookies.length] : undefined;
          const response = await fetch(`${BASE_URL}${path}`, {
            redirect: "manual",
            headers: cookie ? { cookie } : {},
            signal: AbortSignal.timeout(15_000),
          });
          await response.arrayBuffer();
          const toSignIn = (response.headers.get("location") ?? "").includes("/sign-in");
          if (response.status >= 500 || (cookie && (response.status >= 400 || toSignIn))) {
            failures += 1;
          }
        } catch {
          failures += 1;
        }
        durations.push(performance.now() - t0);
      }
    }),
  );
  const seconds = (performance.now() - started) / 1000;
  const sorted = [...durations].sort((a, b) => a - b);
  return {
    path,
    requests: durations.length,
    failures,
    errorRate: failures / durations.length,
    requestsPerSecond: Math.round(durations.length / seconds),
    p50: Math.round(percentile(sorted, 50)),
    p95: Math.round(percentile(sorted, 95)),
    p99: Math.round(percentile(sorted, 99)),
  };
}

if (EMAILS.length > 0 && !PASSWORD) throw new Error("LOAD_PASSWORD is required with LOAD_EMAILS");
const cookies = await Promise.all(EMAILS.map(signIn));
if (cookies.length > 0) console.log(JSON.stringify({ signedInAs: EMAILS.length }));

let failed = false;
for (const path of PATHS) {
  const result = await run(path, cookies);
  console.log(JSON.stringify(result));
  if (result.p95 > P95_BUDGET_MS || result.errorRate > MAX_ERROR_RATE) failed = true;
}
if (failed) {
  console.error("Load budget missed (see p95 / errorRate above).");
  process.exit(1);
}
