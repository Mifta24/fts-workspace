# 08 — Delivery Roadmap

No durations are commitments; estimate after technical discovery and staffing assessment. Ship in tested, small vertical slices.

**Product direction (2026-10-30, ADR-017):** keep the product simple and easy to use. New people see a simple navigation (everyday work only) and opt in to the rest; features that few people would use, or that need a lot of setup, are not built even though earlier phases listed them. Such items stay in the lists below, marked *not planned*, so the reason is not lost.

## Phase 0 — Foundation
- [x] Repository, package manager, lint/format/typecheck, CI
- [x] Next.js App Router, Tailwind, shadcn/ui-style primitives, i18n baseline (`en`/`ja`/`id`)
- [x] PostgreSQL/Prisma migrations and seed strategy
- [x] Better Auth integration, sessions, email flow (development log transport only)
- [x] Organization model, membership, authorization service
- [x] Docker dev environment, secrets configuration, observability baseline (structured logs, health check, correlation id, audit log)
**Exit gate:** login and tenant isolation integration tests pass; CI reproducible. Verified locally on 2026-10-28: lint, format, typecheck, 32 tests, build. CI has run since: it passes on `main` (run 41599036120, commit `0d8e41d`, 2026-11-03).
**Phase 0 notes:** a production email provider and an error monitoring/tracing vendor are not chosen yet. Since Phase 5 an SMTP transport exists (any provider with SMTP) and the auth rate limiter keeps its counters in the database (ADR-019), still production only.

## Phase 1 — Productivity MVP
- [x] Project and goal CRUD with nested tree (slices 1 and 5: create, edit and archive in the UI; milestones in slice 6)
- [x] Goal cycle prevention and progress calculation (manual and numeric KPI; task/milestone modes report null until tasks exist)
- [x] Task CRUD, assignments, status, deadlines, comments (slice 2; slice 5 added the full task edit form, slice 6 subtask UI and milestones)
- [x] Dashboard KPIs and filterable views (slice 3: overview page with project/assignee/time-range filters)
- [x] AI task planner with review/approval (slice 6: provider adapter, draft → review → apply; disabled until `AI_BASE_URL` and `AI_MODEL` are set)
- [x] E2E paths (slice 4: Playwright owner flow, cross-tenant 404s, viewer read-only; run in CI)
- [x] Responsive UI checked at 375px width (no horizontal page scroll, usable navigation); no visual design review yet
**Exit gate:** key persona flows run end-to-end; cross-tenant tests pass. Met on 2026-10-29: Vitest and Playwright pass locally and in CI (commit `538e25f`, GitHub Actions run 40822659332).
**Phase 1 notes:** member invitations were not on the Phase 1 checklist and were added afterwards (see below); `role_grants` remain deferred; there is no real model connected yet (OD-08), so AI planning is verified with a fake provider and a seeded draft; AI plan dependencies between tasks (`task_dependencies`) are not built.

**Post-gate addition (2026-10-29):** member invitations (create, list, revoke, accept; members page).

## Phase 2 — Collaboration & Engagement
- [x] Dedicated realtime service and authenticated channels (slice 8: Socket.IO gateway, ADR-012)
- [x] DM, channels, pagination, notifications (slice 7, database-backed; realtime delivery is the next slice; slice 25, ADR-020: the worker tells an assignee once when a task is due within a day; mentions are not built)
- [x] Audit-backed point events, challenges, streaks, leaderboard visibility (slice 9: task-completion points only)
**Exit gate:** permissions tested on socket joins; load tests for message delivery. Both exist (`tests/integration/gateway.test.ts`, `pnpm test:load`); the challenge/points item is still open, so the gate is met: Vitest, the 2,000-socket load run (local: 200,000 deliveries, 0 lost, p95 37 ms in one process; CI runs a 300-socket version) and Playwright pass in CI (commit `dd08310`, run 40832283718). Not built in Phase 2: mentions, presence/typing, file attachments, a Redis adapter for several gateway instances.

## Phase 3 — AI & Knowledge
- [x] File upload, ACL, metadata, storage lifecycle (slice 10: local-disk storage adapter behind a port; the production store is still OD-04; no malware scanning yet)
- [x] Knowledge docs and retrieval (slice 11: keyword full-text search with the file ACL applied inside the query; **semantic/embedding retrieval is not built**, see ADR-013)
- [x] Permission-aware AI features, audit, budgets (slice 12: knowledge assistant with ACL-filtered retrieval, token ledger and daily budgets; the model has **no tool-calling**, see `11-MCP-THREAT-MODEL.md`)
- [x] Background ingestion (slice 11: Postgres-backed queue and `pnpm worker`) and MCP threat model (`docs/11-MCP-THREAT-MODEL.md`, analysis only)
- [x] Automation prototype (slice 24, ADR-018: three fixed, built-in rules that an owner or admin switches on, all off by default: notify a form's owner of a submission, create a follow-up task for it, and note a new booking on the visitor's contact; they run from the job queue, act once, only inside the workspace, and carry no visitor-written text; **no rule builder, and no model that chooses or runs actions**: that needs a real model provider (OD-08) and the approval design in `11-MCP-THREAT-MODEL.md`)
**Exit gate:** document ACL holds across retrieval; no unauthorized tool execution. Met for what exists: the ACL parity and retrieval tests, the file and knowledge E2E tests, and the absence of any model tool execution (`11-MCP-THREAT-MODEL.md`) pass in CI (commit `eb5ec94`, run 40836686028). The automation slice (commit `a072bb7`) was verified locally on 2026-10-30 (lint, format, typecheck, 470 Vitest tests including cross-tenant and run-once tests, build, 45 Playwright tests with 1 opt-in skipped); its CI run is now recorded in the Phase 5 note below (`main` passed in CI on 2026-11-03, run 41599036120). The fixed rules run no model and no model-chosen action, so the no-unauthorized-tool-execution part of the gate is unchanged. **Phase 3 is closed for the scope built.** **Not delivered in Phase 3:** semantic/embedding retrieval, PDF/office extraction, malware scanning, a rule builder or any model-run automation (only the three built-in rules exist, ADR-018), a production object store (OD-04) and a chosen model provider (OD-08).

## Phase 4 — Business
- [x] CRM contacts and deal stages (slice 13: contacts, consent history, erasure, deals, activity timeline, pipeline report; slice 19: customer journey stages with append-only history)
- [~] Scheduling (slice 14: meetings with attendees, conflict protection, responses, notifications; slice 16: reminders from the worker and per-user time zones; slice 20: read-only calendar subscription link (.ics); slice 21: public booking pages (anonymous slot booking with consent and CRM contact); slice 22: Google Calendar connection that reads free/busy only, so booking pages skip times when the owner is busy there (ADR-016); **not planned (ADR-017): two-way sync (meetings are not written to Google) and Outlook; waiting for an email provider: confirmation emails and visitor-side cancellation**)
- [~] Templates/forms (slice 15: template-based forms, public submission links, consent capture, submissions; slice 17: editable fields (labels only after publishing) and templates in en/ja/id; optional Turnstile captcha on public forms and booking pages (slice 22, ADR-014); **no file uploads on public forms: member uploads can be virus-scanned since 2026-11-03 (ADR-025, needs ClamAV on the server), but the form field itself is not built**) and the pipeline report; slice 18: insights page (contacts and consent, forms, own meetings; counts for 7/30/90 days against the previous period)
**Exit gate:** privacy controls, consent pathways, and reliable reporting. Met for the scope built, verified locally on 2026-10-30: lint, format, typecheck, 389 Vitest tests, build, 38 Playwright tests, and the opt-in captcha run against Cloudflare's dummy keys (`pass` and `fail`); CI has since run on `main` and passes (run 41599036120, 2026-11-03). Privacy and consent: consent history and erasure (including a booking visitor's note), consent captured on public forms and booking pages with PII kept out of the audit trail, append-only consent and journey history. Reporting: the insights page and pipeline report are counts only, scoped to what the caller may see, with period edges, empty cases and cross-tenant tests. **Not delivered in Phase 4:** two-way calendar sync and Outlook (*not planned*, ADR-017; what exists is the read-only `.ics` link and a one-way Google free/busy read, ADR-016, and nothing is written to external calendars), confirmation emails and visitor-side cancellation of bookings (blocked on a production email provider), file uploads on public forms (blocked on malware scanning and OD-04), working-hours availability across several people, and a captcha-less deployment still depends on the volume caps.

## Phase 5 — SaaS & Production
- [~] Plans, feature entitlements, AI usage pricing, subscriptions (slice 23, ADR-015: plan catalog in code, `subscriptions` row, limits for seats, storage and AI tokens (daily and monthly, hard stop), feature switches for AI, CRM and public pages, trials, plans set by an operator; **no prices, no payment provider, no self-serve checkout, no overage billing**: OD-05 is still open)
- [~] Admin operations, monitoring, incident procedures (slice 23: operator console `/admin` with platform health counts, plan changes and workspace suspension, all audited; `docs/12-OPERATIONS.md` has signals, incident procedure and runbooks; **no monitoring vendor; email alerts from the health check go to one recipient on the pilot server**; two-step sign-in is required of operators since 2026-11-03, ADR-025)
- [x] Two-step sign-in with an authenticator app, required for operators (ADR-025); the operator account has it on
- [x] Workspace deletion: the owner asks, 14 days wait, then removal by operator button, `pnpm purge:workspace` or an opt-in worker sweep (ADR-024); tried on the server on 2026-11-03
- [x] Virus scan of uploads with ClamAV (ADR-025); installed on the server, `MALWARE_SCAN=optional`; a clean file was stored and the test virus refused through the public site
- [x] Restore rehearsal with data and files on the server (2026-11-03: 45 tables equal, files identical)
- [x] Load test with login (`pnpm test:load:http`); run against the public site on 2026-11-03: 800 requests, no failures
- [~] Security review (self-review and dependency/secret checks done; **no independent review**, no CSP `script-src`)
- [~] Off-server backup copy (`deploy/backup-offsite.sh` is ready and tested against a stand-in; **no destination chosen, never run on the server**)
- [x] Pilot onboarding and feedback prioritization (`docs/14-PILOT.md`: process only, there is no in-app feedback form)
**Exit gate:** production-readiness checklist approved. **Not approved:** the checklist (`docs/13-PRODUCTION-READINESS.md`) lists what was verified on 2026-10-30 (lint, format, typecheck, 414 Vitest tests, build, 42 Playwright tests with 1 opt-in skipped; CI has since run on `main` and passes: run 41599036120 at commit `0d8e41d`, 2026-11-03, with lint, format, typecheck, 534 Vitest tests, build, the realtime load and restore rehearsal, `pnpm audit --prod` and Playwright) and ten launch blockers. Since 2026-11-02 the pilot is public at `https://workspace.fts-tech.co.id` on the owner's Plesk VPS (ADR-022, `docs/12-OPERATIONS.md`) with SMTP email working for sign-up verification; password-reset and invitation emails, deliverability, backups off the server, alerting and the other blockers are still open. Since the same day: Turnstile is set on the server, public `/privacy` and `/terms` pages (en, id, ja, draft, no legal review) exist, and workspace owners can request deletion (ADR-023); since 2026-11-03 the removal after the waiting period is built too (ADR-024: operator button, `pnpm purge:workspace`, opt-in worker sweep), not yet tried on the server.

## Interface refresh (ADR-021)
- [x] Colour tokens in light and dark, Plus Jakarta Sans, progress thread, landing page with an example goal, light sidebar (commits `555933f` and `87ff39c`)
- [x] Input border contrast raised to 3:1 on cards
- [x] Font self-hosted (committed file, no Google fetch at compile time) and the Schedule page link spacing fixed
- [x] Raw message key on the Automations page fixed, with a test that every message in en, id and ja parses and that the three languages have the same keys
- [x] Top bar line, wordmark on the sign-in family of pages, and a browser check of the main signed-in pages (see `05-UI-UX.md` for what was and was not viewed)
- [x] Date-dependent `insights` form tests fixed (the fixed "now" moved to 2040-06-30; the old 2026-11-30 broke once the real date entered that period). The `automations` and `reminders` tests broke on 2026-11-03 for the same reason (jobs get the database's real time, the tests used 2026-11-02) and now use 2040-01-02, a Monday. Other tests (`booking`, `calendar-feed`, `calendar-sync`, `scheduling`, `task-deadline-reminders`, `billing`) still use a fixed "now" of November 2026; they pass today and were not changed, so they may break the same way

## Suggested first implementation tickets
1. Bootstrap Next.js TypeScript repo and scripts.
2. Create auth adapter and organization schema.
3. Write centralized `getAuthorizedOrganization()` service.
4. Build org creation and switcher.
5. Write tenant-isolation tests.
6. Create project and goal schemas with recursive relation checks.
7. Implement goal CRUD and tree UI.
8. Implement task CRUD and assignment.
9. Build dashboard rollups.
10. Implement AI proposal preview and manual apply.

## Track progress
Every ticket needs owner, acceptance criteria, dependencies, estimate, tests and rollout notes. Revisit scope at each phase boundary.
