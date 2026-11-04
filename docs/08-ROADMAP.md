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
**Exit gate:** login and tenant isolation integration tests pass; CI reproducible. Verified locally on 2026-10-28: lint, format, typecheck, 32 tests, build. CI has run since: it passes on `main` (run 41601317852, commit `f8ef6dc`, 2026-11-03).
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
**Exit gate:** document ACL holds across retrieval; no unauthorized tool execution. Met for what exists: the ACL parity and retrieval tests, the file and knowledge E2E tests, and the absence of any model tool execution (`11-MCP-THREAT-MODEL.md`) pass in CI (commit `eb5ec94`, run 40836686028). The automation slice (commit `a072bb7`) was verified locally on 2026-10-30 (lint, format, typecheck, 470 Vitest tests including cross-tenant and run-once tests, build, 45 Playwright tests with 1 opt-in skipped); its CI run is now recorded in the Phase 5 note below (`main` passed in CI on 2026-11-03, run 41601317852). The fixed rules run no model and no model-chosen action, so the no-unauthorized-tool-execution part of the gate is unchanged. **Phase 3 is closed for the scope built.** **Not delivered in Phase 3:** semantic/embedding retrieval, PDF/office extraction, malware scanning, a rule builder or any model-run automation (only the three built-in rules exist, ADR-018), a production object store (OD-04) and a chosen model provider (OD-08).

## Phase 4 — Business
- [x] CRM contacts and deal stages (slice 13: contacts, consent history, erasure, deals, activity timeline, pipeline report; slice 19: customer journey stages with append-only history)
- [x] Scheduling (slice 14: meetings with attendees, conflict protection, responses, notifications; slice 16: reminders from the worker and per-user time zones; slice 20: read-only calendar subscription link (.ics); slice 21: public booking pages (anonymous slot booking with consent and CRM contact); slice 22: Google Calendar connection that reads free/busy only (ADR-016); slice 26: booking confirmation email with a link the visitor uses to cancel (SMTP, ADR-019))
- [x] Templates/forms (slice 15: template-based forms, public submission links, consent capture, submissions; slice 17: editable fields (labels only after publishing) and templates in en/ja/id; optional Turnstile captcha on public forms and booking pages (slice 22, ADR-014); slice 18: insights page (contacts and consent, forms, own meetings; counts for 7/30/90 days against the previous period))
**Exit gate:** privacy controls, consent pathways, and reliable reporting. Met: lint, format, typecheck, Vitest (561 tests on 2026-11-03), build and the booking Playwright tests pass; CI passes on `main`. Privacy and consent: consent history and erasure (including a booking visitor's note), consent captured on public forms and booking pages with PII kept out of the audit trail, append-only consent and journey history. Reporting: the insights page and pipeline report are counts only, scoped to what the caller may see, with period edges, empty cases and cross-tenant tests. **Phase 4 is closed.** To keep the product simple (ADR-017) the complicated leftovers are not planned and were removed from this list.

## Phase 5 — SaaS & Production
- [x] Plans, limits, trials and the operator console `/admin` (ADR-015; prices and checkout are later, OD-05)
- [x] Monitoring: the server mails the operator when its health check fails, and an outside check (GitHub Actions, every 10 minutes) watches `/api/health`; error tracking and paging are later
- [x] Two-step sign-in with an authenticator app, required for operators (ADR-025); the operator account has it on
- [x] Workspace deletion: the owner asks, 14 days wait, then removal by operator button, `pnpm purge:workspace` or an opt-in worker sweep (ADR-024); tried on the server on 2026-11-03
- [x] Virus scan of uploads with ClamAV (ADR-025); installed on the server, `MALWARE_SCAN=optional`; a clean file was stored and the test virus refused through the public site
- [x] Restore rehearsal with data and files on the server (2026-11-03: 45 tables equal, files identical)
- [x] Load test with login (`pnpm test:load:http`); run against the public site on 2026-11-03: 800 requests, no failures
- [x] Security review (self-review and dependency/secret checks; an independent review and CSP `script-src` are later)
- [x] Backups copied off the server every day to the owner's Mac and verified (`deploy/backup-pull.sh` + a launchd job, 2026-11-03); a cloud bucket (`deploy/backup-offsite.sh`) is later
- [x] Email through our own mail server: the password-reset mail was signed and accepted by Gmail (2026-11-03)
- [x] Pilot onboarding and feedback prioritization (`docs/14-PILOT.md`: process only, there is no in-app feedback form)
**Exit gate:** `13-PRODUCTION-READINESS.md` signed off. **Pilot-ready; the product owner approved it on 2026-11-04, the other sign-off rows are still blank.** Before real customers: a lawyer's review of privacy and terms (brief: `15-LEGAL-REVIEW-BRIEF.md`) and one more purge/restore try at real data size. Everything else is under *Later* there.

## Interface refresh (ADR-021)
- [x] Colour tokens in light and dark, Plus Jakarta Sans, progress thread, complete product landing page with an illustrative workspace preview (en/id/ja), light sidebar (commits `555933f` and `87ff39c`; landing-page refresh verified 2026-11-03)
- [x] Input border contrast raised to 3:1 on cards
- [x] Font self-hosted (committed file, no Google fetch at compile time) and the Schedule page link spacing fixed
- [x] Raw message key on the Automations page fixed, with a test that every message in en, id and ja parses and that the three languages have the same keys
- [x] Top bar line, wordmark on the sign-in family of pages, and a browser check of the main signed-in pages (see `05-UI-UX.md` for what was and was not viewed)
- [x] Date-dependent tests fixed: the `insights`, `automations`, `reminders`, `booking`, `calendar-feed`, `calendar-sync`, `scheduling`, `task-deadline-reminders` and `billing` tests now use a fixed "now" in January 2040 (a Monday), which the real clock cannot pass. The one test that goes through the HTTP route of the calendar feed reads the real clock and books relative to it (2026-11-04: 561 tests pass)

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
