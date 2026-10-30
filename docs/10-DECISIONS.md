# 10 — Architecture Decision Records (ADRs)

Each record: ID, status, context, decision, consequences, review trigger. Proposed decisions should be reviewed at project kickoff.

## ADR-001 — Next.js App Router
**Status:** Proposed accepted in product discussion.  
**Decision:** Next.js + TypeScript for full-stack application.  
**Reason:** unified UI/server development and modular feature delivery.  
**Consequence:** long-running workers and realtime gateway deployed separately.

## ADR-002 — Modular monolith
**Status:** Proposed.  
**Decision:** single application with explicit domain modules, not microservices at launch.  
**Consequence:** simpler operations; avoid cross-domain circular imports.

## ADR-003 — PostgreSQL + Prisma
**Status:** Proposed.  
**Reason:** transactional integrity, developer productivity and query control.  
**Consequence:** add DB constraints and performance profiling; verify driver/ORM support.

## ADR-004 — Better Auth organizations
**Status:** Proposed.  
**Decision:** use a vetted auth library with organizations and role support after plugin compatibility review.  
**Consequence:** auth tables and permission hooks follow integration's documented schema.

## ADR-005 — Shared-schema tenancy
**Status:** Proposed.  
**Decision:** organization-scoped tables in shared PostgreSQL database.  
**Consequence:** strict query scoping, tenant-aware FK design, negative security tests, possible RLS defense in depth.

## ADR-006 — AI actions are human-controlled
**Status:** Proposed.  
**Decision:** AI creates drafts by default; mutations require explicit approval and server-side authorization.  
**Consequence:** slower than unrestricted agents, but safer and auditable.

## ADR-007 — Independent implementation
**Status:** Required.  
**Decision:** screenshot observations inform requirements, but proprietary code, private assets, confidential data and pixel-perfect replication are outside scope absent rights/permission.  
**Consequence:** original UX and business rules, with assumptions documented.

## ADR-008 — Organization membership owned by the application (Phase 0)
**Status:** Accepted for Phase 0 (2026-10-28); invitations built as app services on 2026-10-29 (reviewed: the plugin was still not adopted).  
**Context:** ADR-004 required a compatibility review of the Better Auth organization plugin. The plugin exposes its own HTTP endpoints for creating organizations, inviting members, and changing roles, with its own access-control checks. It has no membership status (needed for "disabled membership" tests in `07-SECURITY.md`) and its mutations would bypass the application audit trail and permission matrix.  
**Decision:** Better Auth handles identity only (email/password, email verification, password reset, sessions). `organizations`, `members` and `audit_logs` are application tables. All organization access is resolved by `getAuthorizedOrganization()` / `requirePermission()` in `src/features/organizations/server/organization-service.ts`, using the single matrix in `src/lib/permissions/matrix.ts`. The organization plugin is **not** enabled, so no `/api/auth/organization/*` endpoints exist. The active workspace is the URL slug, re-checked against membership on every request.  
**Consequences:** one authorization and audit path; invitations, role changes and member removal must be built as feature services in Phase 1. Revisit if the plugin later supports membership status and hooks that fit the audit model.

## ADR-009 — Phase 0 tooling and versions
**Status:** Accepted (2026-10-28).  
**Decision:** versions were checked against npm registry metadata and peer ranges at implementation time:
- Next.js 16.4.3 (App Router, Turbopack; `proxy.ts` replaces `middleware.ts`), React 19.3.1.
- TypeScript 5.9 (typescript-eslint, used by `eslint-config-next`, supports `<6.1`; TypeScript 7 is not yet supported by the lint toolchain).
- ESLint 9 (`eslint-plugin-react` peer range does not include ESLint 10).
- Prisma 7.10.1 with `@prisma/adapter-pg` and `prisma.config.ts` (Prisma 8 is only a release candidate; Better Auth peer range is `^5 || ^6 || ^7`).
- Better Auth 1.7.14 with the Prisma adapter; `advanced.database.generateId: "uuid"` leaves id generation to the ORM, so every table uses `@default(uuid(7))`.
- Tailwind CSS 4 via `@tailwindcss/turbopack`; shadcn/ui-style primitives (`cva` + `tailwind-merge`, `components.json` ready for the shadcn CLI); Radix is added when a primitive needs it.
- next-intl 4 for i18n (closes OD-07 for i18n; rich text package still open).
- Vitest 5; `embedded-postgres` provides PostgreSQL binaries for local tests when Docker is unavailable. CI uses a PostgreSQL service container.
- pnpm 11 as package manager.  
**Consequence:** upgrades follow the change protocol below; re-check peer ranges before bumping major versions.

## ADR-010 — End-to-end tests with Playwright (Phase 1)
**Status:** Accepted (2026-10-29).  
**Decision:** `@playwright/test` 1.64.1 (latest stable at implementation time), Chromium only, specs in `e2e/`, run with `pnpm test:e2e`. The suite starts its own `next dev` on port 3100 with a separate build directory (`NEXT_DIST_DIR=.next-e2e`) so it can run beside a developer's dev server. It uses `next dev` rather than `next start` because the production server rejects `EMAIL_TRANSPORT=log` by design. `e2e/global-setup.ts` migrates and truncates the database, then seeds verified users (tenants `acme`, `globex`); locally it starts an embedded PostgreSQL on port 54330, in CI it reuses the service container (`TEST_DATABASE_URL`, after the Vitest run).  
**Consequence:** sign-up and email verification are covered by the Vitest auth flow tests, not E2E, because E2E users are seeded. Add Firefox/WebKit and phone-width projects when responsive work starts.

## ADR-011 — AI task planner behind a provider port (Phase 1)
**Status:** Accepted (2026-10-29).  
**Context:** the roadmap requires an AI task planner with review and approval, while OD-08 (provider and residency) is open.  
**Decision:** depend on a small `TaskPlanProvider` port with one OpenAI-compatible adapter, configured only through environment variables and off by default. Drafts are persisted as `ai_task_plans`, are private to the requester and become tasks only through an explicit, idempotent apply step. Tests use a fake provider; E2E seeds a draft.  
**Alternatives:** a vendor SDK (ties us to one provider and its streaming types), or streaming output (no benefit for a short structured plan).  
**Consequence:** no data leaves the deployment until an operator sets `AI_BASE_URL`; choosing the real provider is a configuration step after OD-08, plus the usage ledger and budgets listed in `07-SECURITY.md`.

## ADR-012 — Realtime via a Socket.IO gateway (closes OD-03)
**Status:** Accepted (2026-10-29).  
**Context:** Phase 2 needs live chat and notifications with authorization checked on every room join. Next.js route handlers cannot hold WebSocket connections on serverless hosting.  
**Decision:** a separate Node process (`gateway/`, `pnpm gateway`) running Socket.IO 4.8.4 (latest at implementation time; `socket.io` and `socket.io-client` pinned together). Postgres stays the source of truth. The app publishes **identifier-only** events to the gateway over an HTTP endpoint protected by a shared secret (`REALTIME_URL`, `REALTIME_PUBLISH_SECRET`); the browser refreshes server-rendered data when an event arrives. The gateway never trusts the client: it verifies the session by calling the app (`/api/realtime/session`, Better Auth stays the only session authority), resolves the organization from the slug, and checks the active membership and channel membership in the database on every `subscribe`/`join`; sockets are re-validated every 60 seconds and lose rooms whose membership was revoked.  
**Alternatives:** SSE from Next.js (simpler, no extra process, one-way and weaker at fan-out; kept as the fallback shape if the gateway is not wanted), a managed pub/sub vendor (token-based authorization, per-message cost, data leaves the deployment).  
**Consequences:** one more service to run, monitor and patch. If the gateway is down or unconfigured the app keeps working: messages are saved and appear on the next load. Scaling past one instance needs the Socket.IO Redis adapter (not added yet). Browser and gateway must share a cookie domain (same host name; production: reverse proxy `/socket.io`).

## ADR-013 — Postgres job queue and full-text knowledge search (Phase 3)
**Status:** Accepted (2026-10-29).  
**Context:** Phase 3 needs background ingestion and retrieval, while OD-04 (storage), OD-08 (AI provider and residency) and Redis operations are open.  
**Decision:** (1) background jobs use a table-backed queue with `SKIP LOCKED` instead of Redis/BullMQ, so a pilot has no extra service to run and jobs commit atomically with the change that caused them; (2) knowledge retrieval is PostgreSQL full-text search over chunks, with the access rule inside the SQL; (3) files sit behind a storage port with a local-disk adapter; (4) PDF and office extraction are out until a reviewed extractor exists.  
**Alternatives:** BullMQ (richer scheduling, needs Redis), pgvector or an external vector store (needs a provider decision and a different database image).  
**Consequences:** polling latency (≤ 2 s), no cron-style scheduling, and the `simple` text configuration matches whole words without stemming, which is weak for Japanese. Moving to Redis or adding embeddings later changes the queue/search adapters, not the access model.

## ADR-014 — Cloudflare Turnstile as the optional captcha (Phase 4)
**Status:** Accepted (2026-10-30), at the owner's request to add a captcha to the anonymous forms.  
**Context:** the two anonymous write paths (public forms and booking pages) were protected only by a honeypot and per-page volume caps, which a determined bot can exhaust.  
**Decision:** Cloudflare Turnstile, verified server-side with the Siteverify API before an anonymous submission is read. It is optional: it turns on only when both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are set (setting one is a startup error), so development, tests and self-hosted pilots run unchanged. Verification fails closed (a Cloudflare outage blocks anonymous submissions rather than opening them).  
**Alternatives:** hCaptcha or reCAPTCHA (similar, more intrusive or more tracking), a self-hosted proof-of-work challenge (no third party, weaker against determined bots), IP-based rate limiting alone (needs a trustworthy client address behind the proxy).  
**Consequences:** visitors' browsers load a script from `challenges.cloudflare.com` and Cloudflare sees the visit (the public pages' privacy text should be reviewed before enabling it); the widget script must not be proxied or cached; automated tests of the real widget are opt-in (`E2E_CAPTCHA=pass|fail pnpm test:e2e e2e/captcha.spec.ts`, internet needed, Cloudflare's dummy keys).

## Open decisions
- **OD-01:** Which deploy environment/hosting region and target scale?
- **OD-02:** Native PostgreSQL RLS in first release or only after formal verification?
- **OD-04:** Storage provider and retention limits?
- **OD-05:** Pricing model and AI quota/overage policy?
- **OD-06:** Is personal workspace a special organization?
- **OD-07:** Preferred rich text package? (i18n decided: next-intl, ADR-009)
- **OD-08:** Which AI model providers and residency constraints apply?

## Change protocol
Before changing a major decision, add a dated ADR with alternatives, tradeoffs, migration cost and sign-off.
