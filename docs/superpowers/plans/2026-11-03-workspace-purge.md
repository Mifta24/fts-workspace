# Workspace Purge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all data of a workspace (database rows and file bytes) once its owner's deletion request has passed the 14-day wait, through one core function with three triggers: operator button, CLI, and an opt-in worker sweep.

**Architecture:** `purgeWorkspace()` re-checks the rules, deletes file bytes, then in one transaction deletes every row of the organization (children first), turns the organization row into a tombstone and writes one `organization.purged` audit event. The three append-only tables allow DELETE only for the organization named in a transaction-local setting. Triggers add no logic of their own.

**Tech Stack:** Next.js 16 server actions, Prisma 7 with `@prisma/adapter-pg`, PostgreSQL, Vitest integration tests (real database), Playwright, next-intl (en/id/ja), `tsx` scripts. Check `node_modules/next/dist/docs/` before touching Next.js APIs (AGENTS.md).

**Spec:** `docs/superpowers/specs/2026-11-03-workspace-purge-design.md`

## Global Constraints
- Grace period is `DELETION_GRACE_DAYS` (14) via `dueAfter()` in `src/features/organizations/schemas/deletion.ts`; do not copy the number.
- The organization id comes from the operator's slug lookup or the sweep's own query, never from a client-supplied `organizationId` alone (the admin form posts an id, but the service re-reads the row and compares the typed slug).
- Every delete carries `where: { organizationId }`. No unscoped deletes.
- `AUTO_PURGE_ENABLED` defaults to off; only the exact string `true` turns it on.
- The tombstone keeps the organization id; `name` and `slug` become `deleted-<first 12 chars of id>`.
- The final audit event is `organization.purged` with `resourceType: "organization"`; metadata holds only `trigger`, `filesRemoved` and `rowCounts` (no names, emails or content). `audit_logs.actorId` is a UUID column, so CLI and worker events have `actorId: null` and `metadata.trigger` says `cli` or `worker`.
- Strict TypeScript, Zod for untrusted input, business logic in `src/features/organizations/server/`, copy in `messages/{en,id,ja}.json` with identical keys (a test enforces parity).
- Accounts (`users`), backups and data export are out of scope.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus
Inputs the spec implies but no obvious test covers; each is pinned by a test in the task named.
1. Owner cancels and asks again: the new date applies and an early purge is refused (Task 3).
2. Two purges at the same time for one workspace: one does the work, the other reports already purged, exactly one `organization.purged` event (Task 3).
3. A suspended workspace can still be purged (Task 3).
4. The slug of a purged workspace can be used by a new workspace, and a person who belonged to both the purged and another workspace keeps the other membership and the account (Task 3).
5. Confirmation text typed with different case or surrounding spaces is accepted; a different slug is refused without deleting anything (Task 5).

## File Structure
- Create `prisma/migrations/20261103090000_workspace_purge/migration.sql` — `purgedAt` column, replacement trigger functions.
- Modify `prisma/schema.prisma` — `Organization.purgedAt`.
- Modify `src/server/storage/storage.ts` — `StoragePort.deletePrefix`.
- Create `src/features/organizations/schemas/purge.ts` — types, `PURGE_SWEEP_INTERVAL_MS`, `purgeConfirmSchema`.
- Create `src/features/organizations/server/purge-service.ts` — `purgeWorkspace`, `purgeDueWorkspaces`.
- Modify `src/features/admin/server/admin-service.ts`, `actions.ts`, `src/app/[locale]/admin/page.tsx` — operator trigger and display.
- Create `scripts/purge-workspace.ts`; modify `package.json`, `worker/main.ts`, `.env.example`.
- Create tests `tests/integration/workspace-purge.test.ts`, `tests/integration/storage-prefix.test.ts`, `e2e/purge.spec.ts`.
- Modify docs listed in Task 8.

---

### Task 1: Database — `purgedAt` and purge-aware append-only triggers

**Files:**
- Create: `prisma/migrations/20261103090000_workspace_purge/migration.sql`
- Modify: `prisma/schema.prisma` (model `Organization`, after `deletionRequestedBy`)
- Test: `tests/integration/workspace-purge.test.ts` (new; this task adds the `append-only tables` describe block)

**Interfaces:**
- Produces: column `organizations.purgedAt timestamptz null` (Prisma `Organization.purgedAt: Date | null`); the database setting `app.purge_org` (transaction-local, set with `SELECT set_config('app.purge_org', <uuid>, true)`) that lets DELETE through for that organization's rows in `point_events`, `consent_events`, `contact_stage_changes`.

- [ ] **Step 1: Write the failing tests** in `describe("append-only tables")` of `tests/integration/workspace-purge.test.ts` (use `resetDatabase`, `createTestOrganization`). Create one `point_events` row (or whichever of the three tables is simplest to seed; cover all three if seeding is cheap) for organizations A and B. Assertions:
  - `deleteMany({ where: { organizationId: A } })` outside any setting rejects with a message containing `append-only`.
  - UPDATE still rejects with `append-only`, even inside a transaction that set `app.purge_org` to A.
  - Inside `db().$transaction`, after `set_config('app.purge_org', A, true)`, deleting A's rows succeeds and B's rows survive; deleting B's rows in that same transaction still rejects (the whole transaction is expected to throw).
  - After the transaction ends, a new transaction without the setting rejects again (the setting does not leak).

- [ ] **Step 2: Run** `pnpm vitest run tests/integration/workspace-purge.test.ts` — expected: the allow-case fails (still `append-only`).

- [ ] **Step 3: Write the migration.** `ALTER TABLE "organizations" ADD COLUMN "purgedAt" TIMESTAMP(3);` and `CREATE OR REPLACE FUNCTION` for `point_events_reject_change`, `consent_events_reject_change`, `contact_stage_changes_reject_change`: when `TG_OP = 'DELETE'` and `OLD."organizationId"::text = current_setting('app.purge_org', true)` return `OLD`; otherwise raise the existing `<table> is append-only` message. Keep the repo's header comment and a `-- Rollback (manual):` line (drop the column; re-create the three functions with the bodies from migrations `20261029080000_engagement`, `20261029120000_crm`, `20261030100000_customer_journey`). Add `purgedAt DateTime?` with a `///` doc comment to the schema, then run `pnpm db:generate`.

- [ ] **Step 4: Run** the same test file — expected: PASS. Also run `pnpm vitest run tests/integration/gamification.test.ts tests/integration/crm.test.ts tests/integration/journey.test.ts` — expected: PASS (existing append-only tests unchanged).

- [ ] **Step 5: Commit**
```bash
git add prisma tests/integration/workspace-purge.test.ts docs/superpowers
git commit -m "feat(db): purgedAt and append-only triggers that allow a workspace purge"
```

---

### Task 2: Storage — delete everything under an organization prefix

**Files:**
- Modify: `src/server/storage/storage.ts`
- Test: `tests/integration/storage-prefix.test.ts`

**Interfaces:**
- Produces: `StoragePort.deletePrefix(organizationId: string): Promise<number>` — removes the directory `<root>/<organizationId>` and returns how many files it held (0 when absent). `organizationId` must match the UUID pattern or the call throws `Error("Invalid storage key")`.

- [ ] **Step 1: Write failing tests** (temp dir from `node:os` `mkdtemp`, `createLocalStorage`): after `put` of two keys under org A and one under org B, `deletePrefix(A)` returns `2`, `get` of A's keys returns `null`, B's key still returns bytes; `deletePrefix(A)` again returns `0`; `deletePrefix("../x")` and `deletePrefix("")` throw `Invalid storage key`.
- [ ] **Step 2: Run** `pnpm vitest run tests/integration/storage-prefix.test.ts` — expected: FAIL (`deletePrefix` is not a function).
- [ ] **Step 3: Implement** `deletePrefix` on the port type and the local adapter; reuse the UUID part of the existing `KEY` pattern; count with `readdir` before `rm(dir, { recursive: true, force: true })`; ENOENT means 0. Fix every other implementation of `StoragePort` that the typecheck flags (test doubles).
- [ ] **Step 4: Run** the test file and `pnpm typecheck` — expected: PASS.
- [ ] **Step 5: Commit** `feat(storage): delete everything under one organization prefix`.

---

### Task 3: Purge core — rules, deletion, tombstone, audit

**Files:**
- Create: `src/features/organizations/schemas/purge.ts`, `src/features/organizations/server/purge-service.ts`
- Test: `tests/integration/workspace-purge.test.ts` (add `describe("purgeWorkspace")`)

**Interfaces:**
- Consumes: `dueAfter` (`schemas/deletion.ts`), `recordAuditEvent` (`src/server/services/audit.ts`), `AppError` (`@/lib/errors`; codes used: `NOT_FOUND`, `INVALID_INPUT` — check `src/lib/errors.ts` for the code that best means "not allowed yet" and use it consistently), `StoragePort` (Task 2).
- Produces (in `schemas/purge.ts`): `type PurgeTrigger = "admin" | "cli" | "worker"`; `type PurgeActor = { trigger: PurgeTrigger; userId: string | null }`; `type PurgeResult = { organizationId: string; alreadyPurged: boolean; filesRemoved: number; rowCounts: Record<string, number> }`.
- Produces (in `purge-service.ts`): `purgeWorkspace(deps: { prisma: PrismaClient; storage: StoragePort; correlationId?: string }, input: { organizationId: string; actor: PurgeActor }, now?: Date): Promise<PurgeResult>`.

- [ ] **Step 1: Write failing tests** with a helper `seedWorkspace(slug)` that creates an organization plus at least one row in every organization-scoped table (this seeding is the long part; reuse the models' minimal required fields from the other integration tests). Use a fake `StoragePort` (in-memory) for now. Tests, named exactly:
  - `refuses a workspace with no request` / `refuses before the wait has passed` (now = request + `DELETION_GRACE_DAYS` days − 1 s) / `refuses after the owner cancelled` — each leaves all rows in place.
  - `purges a due workspace and leaves the other workspace untouched` — seed A and B, request deletion on A, purge at due time; every table has zero rows for A except `audit_logs`; counts of B in every table (including the three append-only ones) are equal before and after; the organization row for A has `purgedAt = now`, `name` and `slug` equal to `deleted-` + first 12 chars of its id, no deletion fields; `users` rows are untouched.
  - `covers every table that has an organizationId column` — query `information_schema.columns` for `column_name = 'organizationId'` in schema `public`; for each table other than `audit_logs`, assert `count(*) where "organizationId" = A` is 0 after the purge, so a table added later fails this test until the purge list includes it.
  - `writes one organization.purged event with counts only` — exactly one `audit_logs` row for A, action `organization.purged`, `metadata` keys exactly `trigger`, `filesRemoved`, `rowCounts`, serialized metadata contains neither the owner's email nor the workspace's original name.
  - `is idempotent` — second call returns `alreadyPurged: true` and writes no second event.
  - Review Focus tests: `uses the date of the latest request after cancel and re-request`; `two purges at once do the work once` (`Promise.all` of two calls: exactly one result with `alreadyPurged: false`, one `organization.purged` row); `purges a suspended workspace`; `frees the slug and keeps a person's other membership` (create `acme` again after the purge; a user in both workspaces still has the other `member` row and their `users` row).
  - `leaves no jobs to run` — a queued `jobs` row for A is gone and `runJobs` over the remaining queue processes nothing for A.
- [ ] **Step 2: Run** `pnpm vitest run tests/integration/workspace-purge.test.ts` — expected: FAIL (module not found).
- [ ] **Step 3: Implement** the types in `schemas/purge.ts` and `purgeWorkspace`. Algorithm decisions:
  - Load the organization (`NOT_FOUND` if absent). `purgedAt` set → return `alreadyPurged: true` with empty counts. No `deletionRequestedAt` or `now < dueAfter(deletionRequestedAt)` → throw, change nothing.
  - Files step is added in Task 4; for now only the database step.
  - `prisma.$transaction`: first `SELECT id FROM organizations WHERE id = ${id} FOR UPDATE` (tagged `$queryRaw`), then re-read `purgedAt` and the request (a concurrent purge or cancel may have won); then `SELECT set_config('app.purge_org', ${id}, true)`.
  - Delete with `deleteMany({ where: { organizationId } })` in a constant ordered array `PURGE_TABLES: { name: string; run(tx, organizationId): Promise<{ count: number }> }[]`, children before parents, covering the tables listed in the spec's "What the purge does" step 2. The exact order is settled by running the tests: a foreign-key error names the missing child. `audit_logs` is last of the deletes. Record `count` per table in `rowCounts`.
  - Update the organization to the tombstone (fields in Global Constraints; reset `suspendedAt`, `leaderboardVisibility` to `OFF`, `aiDailyTokenBudget` to its schema default), then `recordAuditEvent` for `organization.purged` in the same transaction with `actorId: input.actor.userId`.
- [ ] **Step 4: Run** the test file — expected: PASS. Run `pnpm typecheck`.
- [ ] **Step 5: Commit** `feat(organizations): purge a workspace's data after the waiting period`.

---

### Task 4: Purge core — file bytes first, safe to retry

**Files:**
- Modify: `src/features/organizations/server/purge-service.ts`
- Test: `tests/integration/workspace-purge.test.ts` (add `describe("files")`)

**Interfaces:**
- Consumes: `StoragePort.delete`, `StoragePort.deletePrefix` (Task 2); `FileObject` rows (`files` table; read its storage key column in `prisma/schema.prisma`).
- Produces: `PurgeResult.filesRemoved` counts files whose bytes were removed.

- [ ] **Step 1: Write failing tests** with `createLocalStorage` on a temp dir: seed A with two real files (rows plus bytes via the existing file service or `put`) and one stray byte file under A's prefix with no row, and B with one file. Assertions:
  - After the purge A's bytes are gone (including the stray one), B's bytes and row remain, `filesRemoved` is 3.
  - `keeps the database intact when removing bytes fails` — a storage double whose `deletePrefix` rejects makes `purgeWorkspace` reject; A's rows and `purgedAt: null` are unchanged; with a working storage the next call completes.
  - `rolls back when the database step fails` — force a failure (for example a storage double that works, plus a trigger-level failure by purging with `now` valid but deleting a row type through a stubbed `PURGE_TABLES`… prefer a simpler way: pass a `prisma` whose `$transaction` callback throws via a failing `recordAuditEvent` spy) and assert `purgedAt` is still null and all rows remain; the retry succeeds.
- [ ] **Step 2: Run** the test file — expected: new tests FAIL.
- [ ] **Step 3: Implement** the files step before the transaction (after the rule checks): delete each file row's key with `storage.delete`, then `storage.deletePrefix(organizationId)`; sum for `filesRemoved` (count the larger of rows-with-bytes and prefix count only once per file: use the prefix count when it is ≥ the row count, since it counts what was on disk). A storage error propagates untouched so the database stays unchanged.
- [ ] **Step 4: Run** the test file and `pnpm typecheck` — expected: PASS.
- [ ] **Step 5: Commit** `feat(organizations): purge removes file bytes before database rows`.

---

### Task 5: Operator trigger — service, action, console

**Files:**
- Modify: `src/features/admin/server/admin-service.ts`, `src/features/admin/server/actions.ts`, `src/features/organizations/schemas/purge.ts`, `src/app/[locale]/admin/page.tsx`, `messages/en.json`, `messages/id.json`, `messages/ja.json`
- Test: `tests/integration/workspace-purge.test.ts` (add `describe("operator trigger")`), `e2e/purge.spec.ts`

**Interfaces:**
- Consumes: `purgeWorkspace` (Task 3), `getStorage()` (`src/server/storage/storage.ts`), `Operator`, `requireOperator`.
- Produces: `purgeConfirmSchema = z.object({ organizationId: z.uuid(), confirm: z.string().trim().min(1).max(80) })`; `purgeWorkspaceAsOperator(deps: { prisma: PrismaClient; storage: StoragePort; correlationId?: string }, operator: Operator, rawInput: unknown, now?: Date): Promise<PurgeResult>`; `purgeWorkspaceAction(previous: ActionState, formData: FormData): Promise<ActionState>`; `WorkspaceRow.purgedAt: Date | null`.

- [ ] **Step 1: Write failing tests.** Integration: `accepts the slug in any case with spaces` (`" ACME "` purges), `refuses a different slug and deletes nothing`, `refuses an unknown organization id`, `audit event has trigger admin and the operator's user id` (use `resolveOperator` the way `workspace-deletion.test.ts` does). E2E (`e2e/purge.spec.ts`, seed style from `e2e/billing.spec.ts`): operator signs in, a workspace whose `deletionRequestedAt` is 15 days ago shows the purge form, typing the slug and submitting shows the "Purged" label; the owner of that workspace can no longer open it (404). A workspace requested 1 day ago shows no purge form; a non-operator gets 404 on the action's page.
- [ ] **Step 2: Run** `pnpm vitest run tests/integration/workspace-purge.test.ts` — expected: new tests FAIL.
- [ ] **Step 3: Implement.** `purgeWorkspaceAsOperator`: parse with `purgeConfirmSchema` (`INVALID_INPUT` on failure), read the organization's slug, compare lower-cased with the typed value (`INVALID_INPUT` on mismatch), call `purgeWorkspace` with `actor: { trigger: "admin", userId: operator.userId }`. `purgeWorkspaceAction` mirrors `setSuspendedAction` (`requireOperator`, correlation id, `toActionError`, `revalidatePath`). `listWorkspaces` selects `purgedAt` and returns it; purged rows are listed but show a "Purged {date}" label and no forms. The purge form appears only when `deletionRequestedAt` is set, `dueAfter(...)` ≤ now and not purged, with a typed-slug field and a destructive-styled `ActionButton`, following the existing suspend form in `page.tsx`. Add message keys `admin.purgeLabel`, `admin.purgeConfirm`, `admin.purgeButton`, `admin.purged` to all three catalogs.
- [ ] **Step 4: Run** `pnpm vitest run tests/integration/workspace-purge.test.ts`, the message-parity test (`pnpm vitest run` filtered to the i18n test that checks the catalogs), `pnpm typecheck`, and `pnpm test:e2e e2e/purge.spec.ts` — expected: PASS.
- [ ] **Step 5: Commit** `feat(admin): operators can purge a due workspace`.

---

### Task 6: CLI trigger

**Files:**
- Create: `scripts/purge-workspace.ts`
- Modify: `package.json` (script `"purge:workspace": "tsx --conditions=react-server scripts/purge-workspace.ts"`)
- Test: `tests/integration/workspace-purge.test.ts` (add `describe("cli")`)

**Interfaces:**
- Consumes: `purgeWorkspace` (Task 3). Produces: exported `runPurgeCli(argv: string[], deps: { prisma: PrismaClient; storage: StoragePort; log: (line: string) => void }, now?: Date): Promise<number>` returning the process exit code (0 purged or already purged, 1 refused or bad arguments); the file's top-level code only wires `DATABASE_URL`, `STORAGE_DIR` (default `.data/files`, as in `worker/main.ts`) and `process.exit(await runPurgeCli(...))`, guarded so importing it in tests does not run it.

- [ ] **Step 1: Write failing tests** for `runPurgeCli`: `["acme", "--confirm", "acme"]` on a due workspace returns 0 and logs the counts; missing `--confirm`, or `--confirm` different from the slug, returns 1 and deletes nothing; unknown slug returns 1; a not-due workspace returns 1 and its rows remain; the audit event has `metadata.trigger === "cli"` and `actorId === null`.
- [ ] **Step 2: Run** the test file — expected: FAIL.
- [ ] **Step 3: Implement** `runPurgeCli` (find the organization by slug, call `purgeWorkspace` with `actor: { trigger: "cli", userId: null }`, map `AppError` to exit 1 with its message).
- [ ] **Step 4: Run** the test file — expected: PASS; run `pnpm purge:workspace` with no arguments against a dev database — expected: usage line, exit code 1.
- [ ] **Step 5: Commit** `feat(ops): pnpm purge:workspace for operators on the server`.

---

### Task 7: Worker trigger (opt-in)

**Files:**
- Modify: `src/features/organizations/server/purge-service.ts`, `src/features/organizations/schemas/purge.ts`, `worker/main.ts`, `.env.example`
- Test: `tests/integration/workspace-purge.test.ts` (add `describe("sweep")`)

**Interfaces:**
- Consumes: `purgeWorkspace`, `DELETION_GRACE_DAYS`.
- Produces: `PURGE_SWEEP_INTERVAL_MS = 5 * 60_000`, `PURGE_BATCH = 3`; `purgeDueWorkspaces(deps: { prisma: PrismaClient; storage: StoragePort; correlationId?: string }, now?: Date): Promise<{ purged: number; failed: number }>` — selects up to `PURGE_BATCH` organizations with `purgedAt` null and `deletionRequestedAt` ≤ now − grace (oldest request first), purges each with `actor: { trigger: "worker", userId: null }`, counts a thrown error as `failed` and continues.

- [ ] **Step 1: Write failing tests**: a due workspace and a not-due workspace → only the due one is purged; five due workspaces → three purged per call, the rest on the next call; one workspace whose storage double throws → `failed: 1` and the others still purged; audit `metadata.trigger === "worker"`.
- [ ] **Step 2: Run** the test file — expected: FAIL.
- [ ] **Step 3: Implement** `purgeDueWorkspaces`; in `worker/main.ts` add a sweep next to the deadline sweep that runs only when `process.env.AUTO_PURGE_ENABLED === "true"` (log once at start whether it is on), reusing the existing `storage` and `log`. Document `AUTO_PURGE_ENABLED` (default off, with a one-line warning) in `.env.example`.
- [ ] **Step 4: Run** the test file — expected: PASS. Start `pnpm worker` once against a dev database without the flag and with it, and confirm the start-up log line differs (flag off: no purge happens even with a due workspace).
- [ ] **Step 5: Commit** `feat(worker): opt-in automatic purge of due workspaces`.

---

### Task 8: Documentation and full verification

**Files:**
- Modify: `docs/10-DECISIONS.md` (add ADR-024 above "Open decisions"; mark ADR-023's point (3) as superseded by it), `docs/08-ROADMAP.md`, `docs/13-PRODUCTION-READINESS.md` (blocker 8: purge built; list what is still open), `docs/12-OPERATIONS.md` (runbook: check the request and due date, take a fresh backup, run the button or `pnpm purge:workspace <slug> --confirm <slug>`, verify `/admin` shows Purged; section on `AUTO_PURGE_ENABLED` and its risk), `docs/03-DATABASE.md` (`purgedAt`, tombstone, trigger change), `docs/07-SECURITY.md` (operator capability), `docs/superpowers/specs/2026-11-03-workspace-purge-design.md` (replace "actor `system:cli`" with `actorId: null` plus `metadata.trigger`).

- [ ] **Step 1:** ADR-024 states: decision (core with three triggers, worker off by default), alternatives (operator only; leaving rows and anonymizing; dropping triggers), consequences (a stolen owner session plus 14 unnoticed days can lose a workspace when the flag is on; backups keep the data up to 14 days; accounts remain).
- [ ] **Step 2:** Update the other docs listed above, keeping existing wording style and date format; do not claim the CI workflow ran.
- [ ] **Step 3: Verify** — run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:e2e`; expected: all pass. Report real counts; if something fails or is skipped, say so in the docs and the final report.
- [ ] **Step 4: Commit** `docs: record the workspace purge (ADR-024)`.
