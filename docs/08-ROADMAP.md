# 08 — Delivery Roadmap

No durations are commitments; estimate after technical discovery and staffing assessment. Ship in tested, small vertical slices.

## Phase 0 — Foundation
- [x] Repository, package manager, lint/format/typecheck, CI
- [x] Next.js App Router, Tailwind, shadcn/ui-style primitives, i18n baseline (`en`/`ja`/`id`)
- [x] PostgreSQL/Prisma migrations and seed strategy
- [x] Better Auth integration, sessions, email flow (development log transport only)
- [x] Organization model, membership, authorization service
- [x] Docker dev environment, secrets configuration, observability baseline (structured logs, health check, correlation id, audit log)
**Exit gate:** login and tenant isolation integration tests pass; CI reproducible. Verified locally on 2026-10-28: lint, format, typecheck, 32 tests, build. The CI workflow has not run yet.
**Phase 0 notes:** a production email provider, error monitoring/tracing vendor, and rate-limit storage are not chosen yet; the Better Auth rate limiter uses its default (in-memory, production only).

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
- [x] DM, channels, pagination, notifications (slice 7, database-backed; realtime delivery is the next slice; mentions and deadline reminders are not built)
- [x] Audit-backed point events, challenges, streaks, leaderboard visibility (slice 9: task-completion points only)
**Exit gate:** permissions tested on socket joins; load tests for message delivery. Both exist (`tests/integration/gateway.test.ts`, `pnpm test:load`); the challenge/points item is still open, so the gate is met: Vitest, the 2,000-socket load run (local: 200,000 deliveries, 0 lost, p95 37 ms in one process; CI runs a 300-socket version) and Playwright pass in CI (commit `dd08310`, run 40832283718). Not built in Phase 2: mentions, deadline reminders, presence/typing, file attachments, a Redis adapter for several gateway instances.

## Phase 3 — AI & Knowledge
- [x] File upload, ACL, metadata, storage lifecycle (slice 10: local-disk storage adapter behind a port; the production store is still OD-04; no malware scanning yet)
- [x] Knowledge docs and retrieval (slice 11: keyword full-text search with the file ACL applied inside the query; **semantic/embedding retrieval is not built**, see ADR-013)
- [x] Permission-aware AI features, audit, budgets (slice 12: knowledge assistant with ACL-filtered retrieval, token ledger and daily budgets; the model has **no tool-calling**, see `11-MCP-THREAT-MODEL.md`)
- [x] Background ingestion (slice 11: Postgres-backed queue and `pnpm worker`) and MCP threat model (`docs/11-MCP-THREAT-MODEL.md`, analysis only)
- [ ] Automation prototype (workflows) — not started; it needs a product decision and the tool-registry design described in the threat model
**Exit gate:** document ACL holds across retrieval; no unauthorized tool execution. Met for what exists: the ACL parity and retrieval tests, the file and knowledge E2E tests, and the absence of any model tool execution (`11-MCP-THREAT-MODEL.md`) pass in CI (commit `eb5ec94`, run 40836686028). **Not delivered in Phase 3:** semantic/embedding retrieval, PDF/office extraction, malware scanning, the automation prototype, a production object store (OD-04) and a chosen model provider (OD-08).

## Phase 4 — Business
- [x] CRM contacts and deal stages (slice 13: contacts, consent history, erasure, deals, activity timeline, pipeline report; slice 19: customer journey stages with append-only history)
- [~] Scheduling (slice 14: meetings with attendees, conflict protection, responses, notifications; slice 16: reminders from the worker and per-user time zones; slice 20: read-only calendar subscription link (.ics); slice 21: public booking pages (anonymous slot booking with consent and CRM contact); **no two-way calendar sync, no confirmation emails or visitor-side cancellation**)
- [~] Templates/forms (slice 15: template-based forms, public submission links, consent capture, submissions; slice 17: editable fields (labels only after publishing) and templates in en/ja/id; **no CAPTCHA, no file uploads**) and the pipeline report; slice 18: insights page (contacts and consent, forms, own meetings; counts for 7/30/90 days against the previous period)
**Exit gate:** privacy controls, consent pathways, and reliable reporting.

## Phase 5 — SaaS & Production
- [ ] Plans, feature entitlements, AI usage pricing, subscriptions
- [ ] Admin operations, monitoring, incident procedures
- [ ] Load tests, security review, backup restore rehearsal
- [ ] Pilot onboarding and feedback prioritization
**Exit gate:** production-readiness checklist approved.

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
