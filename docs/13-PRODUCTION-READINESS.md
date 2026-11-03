# 13 — Launch checklist (Phase 5)

The pilot is live at https://workspace.fts-tech.co.id. This list says what is verified, what must happen before real customers, and what is deliberately left for later. Sign-off is a human decision and stays blank until then.

Last updated 2026-11-03. CI passes on `main` (run 41601317852).

## Done and checked

| What | How it was checked |
| --- | --- |
| Lint, format, typecheck, build | CI and `pnpm check` |
| Vitest and Playwright suites (1 opt-in captcha test skipped) | CI |
| Tenant isolation (cross-tenant negative tests on every feature) | Vitest and Playwright |
| Dependencies (production) | `pnpm audit --prod` in CI: no known vulnerabilities |
| Two-step sign-in; required for operators, on for the operator account | tests, and used on the server |
| Plans, limits, trials, operator console `/admin` | tests |
| Workspace deletion after 14 days (button, `pnpm purge:workspace`, opt-in sweep) | tests, and a real purge on the server on 2026-11-03 |
| Virus scan of uploads (ClamAV on the server, `optional` mode) | tests, and through the public site: clean file stored, test virus refused |
| Backup every day on the server; restore with data and files | rehearsal on the server on 2026-11-03: 45 tables equal, files identical |
| Load test with login | public site, 2026-11-03: 800 requests, no failures |
| Email (sign-up, password reset) | reset mail signed with DKIM and accepted by Gmail on 2026-11-03 |
| Public privacy and terms pages (en, id, ja) | live |
| Realtime chat | 2,000-socket test, and in a browser on the server |

## Before real customers

1. **Copy backups off the server.** `deploy/backup-offsite.sh` is ready; it needs a destination (steps in `12-OPERATIONS.md`). Until then a lost server loses its backups.
2. **Lawyer review of the privacy notice and terms** (today a draft). Also a short data-processing agreement for customers.
3. **Notice outages from outside.** Add a second alert address and an outside uptime check on `/api/health` (a free uptime service is enough). Today a dead server cannot mail anyone.
4. **Try the purge and the restore once more with a real customer's data volume** before the first deletion request is due.

## Later (not needed for the pilot)

- Independent security review; CSP `script-src` (needs per-request nonces).
- Prices, checkout and invoices (OD-05); plans and limits already work.
- AI provider and data location (OD-08): AI stays off until decided.
- Region, a second host, a real object store (OD-01, OD-04).
- Error tracking, paging, a named on-call person.
- Data export, a QR code for two-step setup, requiring two-step for owners (`MFA_REQUIRED_FOR_OWNERS`).
- Semantic search, PDF text, rule builder, Redis for several gateways.

## Known and accepted

- One moderate advisory (`minimatch` below 11.0.1) comes only from `eslint`, a development tool that is not shipped. CI audits production dependencies only. Recheck with `pnpm audit` when upgrading eslint.
- The restore and purge rehearsals used very little data; they prove the mechanism, not the time at scale.
- The server is one shared VPS behind Cloudflare (ADR-022).

## Sign-off

| Role | Name | Decision | Date |
| --- | --- | --- | --- |
| Product owner | | | |
| Engineering lead | | | |
| Security | | | |
| Operations / on-call | | | |
