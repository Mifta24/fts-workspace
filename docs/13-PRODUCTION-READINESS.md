# 13 — Production Readiness Checklist

This is the Phase 5 exit gate. **It is not approved.** The first section records what has been verified and how; the second lists what stands between the product and a production launch; approval is a decision for the people accountable for the launch and is left blank on purpose.

Last updated 2026-10-30. Verified locally on that date; the CI workflow has not run on the Phase 5 changes yet.

## Verified
| Area | Result | Evidence |
| --- | --- | --- |
| Static checks | lint, format, typecheck pass | `pnpm lint`, `pnpm format:check`, `pnpm typecheck` |
| Automated tests | 414 Vitest tests pass, 42 Playwright tests run (41 pass, 1 opt-in captcha test skipped by default; it also passes with Cloudflare's dummy keys for `pass` and `fail`) | `pnpm test`, `pnpm test:e2e` |
| Production build | passes | `pnpm build` |
| Tenant isolation | negative tests for the new surfaces: one workspace's plan never applies to another, billing page 404/forbidden across tenants and roles, suspension affects only the suspended workspace | `tests/integration/billing.test.ts`, `e2e/billing.spec.ts` |
| Entitlements | seats (including a concurrency test: 6 parallel invitations, 2 seats left, exactly 2 succeed), storage, daily and monthly AI allowance, feature switches, downgrade keeps data, public links stop answering | `tests/integration/billing.test.ts` |
| Operator console | hidden from non-operators (404), every change audited, idempotent, bad input rejected, suspension is reversible and pauses the workspace's jobs | same |
| Dependency audit | `pnpm audit`: no known vulnerabilities (production and development) | run 2026-10-30 |
| Secrets in the repository | no `.env` tracked; pattern search for private keys and common provider tokens found none | `git ls-files .env`, `git grep` |
| Dangerous APIs | no `dangerouslySetInnerHTML`, `eval` or `new Function` in `src`; the only raw `Unsafe` SQL is constant text in scripts | `git grep` |
| Realtime load | 2,000 sockets, 200,000 deliveries, 0 lost, p95 37 ms in one process (Phase 2 result); CI runs 300 sockets | `pnpm test:load` |
| HTTP load (smoke) | `/api/health` p95 51 ms and `/en/sign-in` p95 523 ms at concurrency 20 (400 requests each, 0 failures) **against `next dev` on a laptop**, so it proves the script works, not production capacity | `pnpm test:load:http` |
| Backup/restore | cold backup of database and files restored with identical rows, migrations, file hashes and per-tenant counts | `pnpm rehearse:restore` (see `12-OPERATIONS.md` for what it does not cover) |
| Accessibility basics | billing and admin pages use headings, labels, `progress` with a label, no horizontal scroll at 375 px | `e2e/responsive.spec.ts` |

## Security review (Phase 5)
Method: automated checks above, then a read-through of the Phase 5 changes against `07-SECURITY.md` and `AGENTS.md` (authorization on every server path, tenant scoping, input validation, audit, idempotency). Done by the implementing engineer, so it is a self-review: it is not independent.

| # | Finding | Status |
| --- | --- | --- |
| 1 | An invitation sent before a workspace was suspended could still be accepted. | **Fixed** (invitations to a suspended workspace look like any dead link) and tested. |
| 2 | Jobs of a suspended workspace (meeting reminders, indexing) would keep running. | **Fixed**: they wait and run after restore; they do not count as backlog. Tested. |
| 3 | No Content-Security-Policy or HSTS. | **Partly fixed**: `frame-ancestors`, `base-uri`, `form-action`, `object-src` and (production) HSTS added; Turnstile still works. |
| 4 | No `script-src` policy (needs per-request nonces). | **Open.** Design before launch. |
| 5 | Operator accounts have no MFA; one stolen operator session can suspend any workspace or change any plan (no member content is reachable). | **Open, accepted for a pilot** with a short allow-list; MFA is a launch item. |
| 6 | Authentication rate limits are per process and in memory (Better Auth default). | **Open** (known since Phase 0); needs shared storage once more than one instance runs. |
| 7 | Entitlement checks cost one extra query per guarded call. | Accepted; no caching, so a plan change takes effect immediately. |
| 8 | Public forms and booking pages still rely on Turnstile (optional) plus volume caps. | **Open**: enable Turnstile in production. |

Not done: an independent penetration test, a threat model for the operator surface beyond the notes in `07-SECURITY.md`, secret scanning and the dependency audit as CI steps (added to the workflow, not yet run there), RLS (OD-02).

## Launch blockers (must be resolved before real customers)
1. **Email provider.** The application refuses to start in production with the log transport, and there is no other. Sign-up verification, password reset and invitations cannot work until one is added.
2. **Hosting and region (OD-01),** file storage (OD-04: the local-disk adapter is not a production store) and the database service with real backups.
3. **Backups on the real stack:** a restore from an actual hot backup into a clean environment, measured recovery time and data-loss window written down, retention set (`12-OPERATIONS.md`).
4. **Monitoring and alert delivery:** a vendor, the thresholds in `12-OPERATIONS.md` wired to a pager, error tracking, and a named on-call person.
5. **Load test on a production-like deployment** (built app, real database service, realistic data volume), including authenticated flows. The current HTTP test is anonymous and was run against a development server.
6. **MFA** (at least for operators and workspace owners) and shared rate-limit storage.
7. **AI provider and data residency (OD-08)** decided and recorded before `AI_BASE_URL` is set anywhere real.
8. **Legal and privacy:** privacy policy, terms, data processing terms, sub-processor list (hosting, email, Cloudflare Turnstile, AI provider), a data-retention and deletion process for whole workspaces, and the breach-notification contact named in `12-OPERATIONS.md`.
9. **Pricing and billing (OD-05).** Plans, limits and the operator console exist, but there are no prices, no checkout and no invoices. Charging customers needs a payment provider, tax handling and webhook handling with idempotency (ADR-015). A pilot can run without this.
10. **File uploads:** malware scanning before enabling uploads on public forms; the same question applies to member uploads for a public launch.

## Not blockers, but known
Semantic retrieval, PDF/office extraction, two-way calendar sync, confirmation emails, an automation/workflow engine, a Redis adapter for several gateway instances, in-app feedback, and a visual design review.

## Sign-off
| Role | Name | Decision | Date |
| --- | --- | --- | --- |
| Product owner | | | |
| Engineering lead | | | |
| Security | | | |
| Operations / on-call | | | |
