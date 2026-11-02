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

## ADR-015 — Plans and entitlements without a payment provider (Phase 5)
**Status:** Accepted (2026-10-30), at the owner's request to start Phase 5.  
**Context:** Phase 5 asks for plans, feature entitlements, AI usage pricing and subscriptions, but OD-05 (pricing model, quota and overage policy) and the choice of a payment processor are open, and the PRD lists payment processing as a non-goal until decided.  
**Decision:** build the entitlement mechanism and leave money out. The plan catalog (FREE, TEAM, BUSINESS) is code (`src/features/billing/schemas/plans.ts`) with seats, storage, a daily and a monthly AI token allowance and three feature switches (`ai`, `crm`, `publicPages`); there are no prices in it. A `subscriptions` row holds only the plan, status (TRIALING or ACTIVE) and trial end. **No row means unmetered** (the behaviour before billing existed), so existing workspaces, self-hosted pilots and the test suite are unaffected. `BILLING_ENABLED=true` makes new workspaces start a trial on TEAM (`BILLING_TRIAL_DAYS`, default 14); an ended trial falls back to FREE with no job needed because the plan is computed from the stored trial end. Plans are set by a platform operator in `/admin` (allow-list `PLATFORM_ADMIN_EMAILS`); there is no self-serve checkout. AI use is a hard stop at the allowance, with **no overage billing**. Moving to a smaller plan never deletes data: it blocks adding more and stops public links from answering.  
**Alternatives:** a billing SaaS or Stripe now (needs the pricing decision, tax and invoicing setup, and webhook handling with idempotency), plan limits as database rows editable at runtime (changes without review), entitlement checks only in the UI (bypassable).  
**Consequences:** a payment provider later means one adapter that writes the same `subscriptions` row from verified, idempotent webhook events; the enforcement points do not change. Until then the numbers in the catalog are pilot defaults, not a commercial offer. Seat limits are enforced under an advisory lock, so concurrent invitations cannot pass the limit. Usage is counted from existing tables (members, invitations, files, `ai_usage_events`), so there is no separate meter to drift.

## ADR-016 — Google Calendar connection reads free/busy only (Phase 4 follow-up)
**Status:** Accepted (2026-10-30), at the owner's request to start calendar sync with Google. Writing meetings to Google and Outlook were then considered and dropped (ADR-017).  
**Context:** booking pages offered times from the owner's weekly hours minus their meetings in this product, so they could offer a time the owner is busy elsewhere. Two-way sync with Google and Outlook was left out of Phase 4 because it needs OAuth, stored credentials and conflict handling.  
**Decision:** a member can connect their own Google Calendar, and the product reads only when they are busy (`calendar.freebusy`, "sensitive" but not "restricted", so no paid security assessment). Booking pages remove those periods from the offered slots, and a booking looks again before it commits. Authorization is plain OAuth 2.0 code flow with a confidential client (server-side secret); `state` is bound to the user in a sealed cookie. The refresh token is stored encrypted (AES-256-GCM, key `CALENDAR_TOKEN_KEY`, bound to organization and user). Nothing is written to Google. The feature is off unless `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `CALENDAR_TOKEN_KEY` are all set. If a connection cannot be read, the page offers nothing and bookings are refused (fail closed). One connection per member per organization, so tenant scoping holds everywhere.  
**Alternatives:** full two-way sync (writes events to Google; many more failure modes: loops, deletes, changed events), the broader `calendar.events` scope (exposes event content we do not need), Microsoft Outlook at the same time (separate OAuth and API; add after Google proves useful), webhooks (need a stable public URL and renewal), PKCE (optional for a confidential client; the Google documentation page we checked did not describe it for web server apps), storing busy periods (more data to protect and keep fresh).  
**Consequences:** while the Google Cloud app is in Testing, only listed test users can connect, refresh tokens expire after about 7 days (people reconnect weekly) and the lifetime cap is 100 test users. Moving to production needs the OAuth consent branding (home page, privacy policy, terms, an authorized domain we own), which waits on the deployment decision (OD-01); until verified, Google shows an "unverified app" warning and the 100-user cap applies. Rotating `CALENDAR_TOKEN_KEY` makes stored tokens unreadable (people reconnect). Google becomes a sub-processor: its name belongs in the privacy policy and sub-processor list.

## ADR-017 — Keep the product simple: simple navigation by default, no two-way calendar sync or Outlook
**Status:** Accepted (2026-10-30), at the owner's direction: "make the web simple so people can use it easily".  
**Context:** the roadmap grew to sixteen sidebar entries, and the remaining Phase 4 items (writing meetings to Google, Outlook, confirmation emails, uploads on public forms) each add setup or choices for the person using the product. Two of them are also blocked on decisions not made yet (production email provider, malware scanning).  
**Decision:** (1) the workspace sidebar starts in a *simple* view (Overview, Goals, Tasks, Projects, Chat, Schedule, Inbox, Members) and a button shows or hides the rest. It is a per-browser cookie, a view preference only: permissions and server-side authorization are unchanged, an unlisted page still opens from a link, and the current page always stays listed. (2) **Not building** two-way calendar sync (meetings written to Google or Outlook) or Outlook free/busy. Reading Google free/busy (ADR-016) already removes the double-booking problem, which is the part people feel. (3) Features that are built but not part of the simple view (CRM, forms, knowledge, insights, billing, challenges) stay available in the full view; nothing was removed.  
**Alternatives:** removing or feature-flagging whole modules per workspace (more settings, and data models stay anyway), a per-workspace mode set by the owner (an extra decision for owners, and a person cannot pick their own), storing the view in the database (follows the person across devices; costs a migration for a small gain, easy to add later).  
**Consequences:** the cookie view does not follow a person to another device or browser. If two-way sync is ever wanted, the notes from this investigation save time: Google's narrower scope `calendar.events.owned` can create, change and delete events on calendars the person owns (instead of the broader `calendar.events`); an event can be created with a client-chosen `id` (base32hex characters, 5 to 1024 long), which makes retries idempotent; creating with `sendUpdates=none` avoids emailing anyone; and including a visitor's name in the event would leave the product's erasure reach, so put only the title in it. Microsoft's free/busy call (`calendar/getSchedule`, least privilege `Calendars.ReadBasic`) does **not** support personal Microsoft accounts, only work or school accounts. Whether `calendar.events.owned` changes Google's verification requirements was not confirmed (check the scope picker on the consent screen).

## ADR-018 — Built-in automation rules, no rule builder and no model-run actions (Phase 3 follow-up)
**Status:** Accepted (2026-10-30), at the owner's request to build the automation feature, starting small.  
**Context:** the roadmap's last Phase 3 item was an automation prototype. A general engine (users write rules, or a model picks and runs tools) is the riskiest surface in the product (`11-MCP-THREAT-MODEL.md`), needs a real model provider (OD-08 is open; only a local LM Studio model exists for development), and conflicts with the keep-it-simple direction (ADR-017).  
**Decision:** ship the foundation only. A catalog of three fixed rules in code, each switched on or off per workspace by an owner or admin (`automation:manage`), all off by default: (1) notify a form's owner of a new submission, (2) create a follow-up task for the owner, due in two days, (3) add a note about a new booking to the visitor's CRM contact. Triggers queue a job (`automation.run`) in the triggering transaction; the worker acts once (unique `automation_runs` row), only inside the workspace, and only with identifiers and the form or meeting name, never what a visitor wrote. Actions are limited to three kinds: an in-app notification, a task, a CRM note. No email, no outside message, no deletion.  
**Alternatives:** a rule builder (conditions and actions chosen by users: much more surface, UI and testing), model-run tools (needs the tool registry, approval flow and a trusted model first), webhooks or email as actions (outbound communication was ruled out, and email waits for a provider), doing the work inline in the request (a failing action would affect the visitor's submission, and retries would be unsafe).  
**Consequences:** a new rule is a code change with its own tests, which keeps review simple. The next steps, once a model provider is chosen, are an "AI proposes an action, a person approves it" flow built on the same action list, and then, only if wanted, per-action opt-in for safe automatic execution. Rules switched on later do not process earlier events. Notifications and tasks created by a rule cannot be traced from a run-history page yet (the audit log has `automation.executed`).

## ADR-019 — SMTP for email and database-backed auth rate limits (Phase 5)
**Status:** Accepted (2026-10-30), at the owner's request to work on the unfinished phases.  
**Context:** the two Phase 5 launch blockers that need no outside decision were "there is no real email transport" and "authentication rate limits are per process". The provider itself (OD-01 hosting, account, domain) is still open.  
**Decision:** (1) add an `smtp` email transport, chosen by `EMAIL_TRANSPORT=smtp` with a single `SMTP_URL`. SMTP is the one interface every email provider offers, so the choice of provider stays open and changes only configuration. It uses `nodemailer` 10.2.1 (exact version; no dependencies, MIT-0, Node 20+; a newer 10.3.1 was refused by the repository's package release-age policy and was not forced). It sends plain text only and refuses line breaks in headers. (2) Auth emails are not awaited, to avoid a timing difference between known and unknown addresses; an invitation is kept when its email fails. (3) Better Auth rate-limit counters move from process memory to a `rate_limits` table, so all instances share them.  
**Alternatives:** a provider's HTTP API directly (ties the code to one vendor), a hosted email SDK (same), an outbox table with retries (more reliable delivery, more moving parts; worth it once volume or deliverability matters), Redis for rate limits (another service to run, ADR-013), and leaving limits in memory (each instance gets its own allowance).  
**Consequences:** a failed auth email is only logged, so the person asks again and operators should watch the log (alerts are still an open Phase 5 item). There is no delivery receipt or bounce handling. The rate limiter adds a database read and write per limited auth request. Nothing was sent to a real provider in tests: the SMTP code is tested against a local SMTP server that records the conversation. Confirmation emails and visitor cancellation for bookings (Phase 4) become possible but are not built, in keeping with ADR-017.

## ADR-020 — Task deadline reminders as a worker sweep (Phase 2 leftover)
**Status:** Accepted (2026-10-31), at the owner's request to finish the unfinished phases.  
**Context:** Phase 2 left "deadline reminders" unbuilt. Tasks change in many places (create, edit, assign, status), so queueing one job per change would mean hooking every path and cancelling jobs when a task moves.  
**Decision:** the worker runs a sweep every five minutes. It finds open, assigned tasks whose due date falls within the next 24 hours, in workspaces that are not suspended, and sends the assignee one in-app `TASK_DUE_SOON` notification. A `task_due_reminders` row (unique per task, person and due date) is written in the same transaction as the notification, so repeating the sweep sends nothing new; a new due date or a new assignee earns a new reminder. Each task is re-read inside its own organization before anything is written. Overdue, done and cancelled tasks are left alone. In-app only: no email, no per-person settings.  
**Alternatives:** a job per task with a run-at time (precise, but every edit path must replace the job), reminders at several offsets (more noise; "keep it simple", ADR-017), email reminders (waits for a real provider).  
**Consequences:** a reminder can arrive up to five minutes late. If the worker is down, reminders resume when it returns, and a task that has already become overdue is not announced. Mentions in chat and comments are still not built.

## ADR-021 — Visual identity: green palette, one family, and a progress thread
**Status:** Accepted (2026-11-02), at the owner's request for a simple, good-looking design.  
**Context:** the interface was the stock shadcn look: indigo on slate, system font, dark sidebar. It worked but had no identity, and the product's central idea (a big goal becomes small, tracked steps) was not visible in it. The direction must stay simple (ADR-017) and keep the existing component library and semantic tokens.  
**Decision:** (1) change the semantic tokens only: a cool off-white background, a green-black ink, a deep green primary (`#0F6B5C` light, `#3DB8A0` dark), amber for "due soon", and a light tinted sidebar. (2) Use one typeface, Plus Jakarta Sans, as a Latin-subset variable `woff2` file committed in `src/app/fonts/` and loaded with `next/font/local` (SIL OFL), with the system Japanese fonts as fallback. It was first loaded with `next/font/google`, which fetches from Google at compile time; a failed fetch slowed the dev server badly, so the file was committed instead. (3) Add a single signature element, the progress thread, and use it only for progress toward something. (4) Cards lose their shadow; the landing page shows an example goal instead of a marketing hero. Written rules are in `05-UI-UX.md`.  
**Alternatives:** keeping indigo and changing only spacing (no identity), a cream and terracotta or a black and neon look (common defaults, not tied to the product), bundling a Japanese web font (large download for one locale), a custom component library (cost without need).  
**Consequences:** all colour comes from tokens, so a later palette change is one file. Builds and the dev server work offline. The font file is 27 KB and covers Latin only, so Vietnamese and Latin Extended characters fall back to the system font. Form field borders were darkened (`--input`) to reach 3:1 on cards; this applies to every field and outline button. Features still reach every page through the same components; no behaviour, permission or data changed.

## Open decisions
- **OD-01:** Which deploy environment/hosting region and target scale?
- **OD-02:** Native PostgreSQL RLS in first release or only after formal verification?
- **OD-04:** Storage provider and retention limits?
- **OD-05:** Pricing model and AI quota/overage policy? (Partly answered by ADR-015: plan limits and a hard AI stop exist; prices, a payment provider and any overage policy are still open.)
- **OD-06:** Is personal workspace a special organization?
- **OD-07:** Preferred rich text package? (i18n decided: next-intl, ADR-009)
- **OD-08:** Which AI model providers and residency constraints apply?

## Change protocol
Before changing a major decision, add a dated ADR with alternatives, tradeoffs, migration cost and sign-off.
