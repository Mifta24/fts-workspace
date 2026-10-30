/**
 * HTTP load test against a running instance: `BASE_URL=https://staging.example pnpm test:load:http`
 *   BASE_URL          target (default http://localhost:3000)
 *   CONCURRENCY       parallel requests (default 20)
 *   REQUESTS          total requests per path (default 400)
 *   PATHS             comma-separated paths (default /api/health,/en/sign-in)
 *   P95_BUDGET_MS     fail when a path's p95 is above this (default 1500)
 *   MAX_ERROR_RATE    fail when more than this share of requests fail (default 0.01)
 *
 * Anonymous GETs only: it sends no credentials and writes nothing. Point it at staging, never at
 * a shared production system without agreement. Against `next dev` the numbers describe the dev
 * server, not production capacity. Exits non-zero when a budget is missed.
 */
export {};

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 20);
const REQUESTS = Number(process.env.REQUESTS ?? 400);
const PATHS = (process.env.PATHS ?? "/api/health,/en/sign-in").split(",").map((p) => p.trim());
const P95_BUDGET_MS = Number(process.env.P95_BUDGET_MS ?? 1500);
const MAX_ERROR_RATE = Number(process.env.MAX_ERROR_RATE ?? 0.01);

const percentile = (sorted: number[], p: number) =>
  sorted.length === 0
    ? 0
    : sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;

async function run(path: string) {
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
          const response = await fetch(`${BASE_URL}${path}`, {
            redirect: "manual",
            signal: AbortSignal.timeout(15_000),
          });
          await response.arrayBuffer();
          if (response.status >= 500) failures += 1;
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

let failed = false;
for (const path of PATHS) {
  const result = await run(path);
  console.log(JSON.stringify(result));
  if (result.p95 > P95_BUDGET_MS || result.errorRate > MAX_ERROR_RATE) failed = true;
}
if (failed) {
  console.error("Load budget missed (see p95 / errorRate above).");
  process.exit(1);
}
