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
**Exit gate:** key persona flows run end-to-end; cross-tenant tests pass. Met locally on 2026-10-29 (Vitest + Playwright); CI result to be confirmed after push.
**Phase 1 notes:** member invitations (`invitations`, `role_grants`) were not on the Phase 1 checklist and remain deferred; there is no real model connected yet (OD-08), so AI planning is verified with a fake provider and a seeded draft; AI plan dependencies between tasks (`task_dependencies`) are not built.

## Phase 2 — Collaboration & Engagement
- [ ] Dedicated realtime service and authenticated channels
- [ ] DM, channels, pagination, notifications
- [ ] Audit-backed point events, challenges, streaks, leaderboard visibility
**Exit gate:** permissions tested on socket joins; load tests for message delivery.

## Phase 3 — AI & Knowledge
- [ ] File upload, ACL, metadata, storage lifecycle
- [ ] Knowledge docs and semantic retrieval
- [ ] Permission-aware AI tools, audit, budgets
- [ ] Background ingestion, automation prototype, MCP threat model
**Exit gate:** document ACL holds across retrieval; no unauthorized tool execution.

## Phase 4 — Business
- [ ] CRM contacts and deal stages
- [ ] Scheduling and customer journeys
- [ ] Analytics, reports, templates/forms
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
