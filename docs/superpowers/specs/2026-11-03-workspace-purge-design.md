# Workspace purge — design

Status: draft for review (2026-11-03). Closes the "removal after the waiting period is not built" part of launch blocker 8 in `docs/13-PRODUCTION-READINESS.md`. Amends ADR-023 (a new ADR-024 records the change).

## Intent
An owner can already ask for a workspace to be deleted (ADR-023: a timestamp, 14 days of waiting, cancel at any time, audited). Nothing removes the data afterwards; an operator would have to do it by hand, and a plain `DELETE FROM organizations` fails because of append-only triggers and `RESTRICT` keys, and files live outside the database.

Success means:
- Once the request still stands and the waiting period has passed, all of that workspace's data is gone from the live system: database rows and file bytes.
- No other workspace is touched (cross-tenant tests prove it).
- One audit event records that the purge happened, with row counts and the actor, and no personal data.
- Running it again, or after a crash halfway, is safe and finishes the job.

Out of scope: deleting global `User` accounts (a person may belong to other workspaces; account deletion is a separate request), deleting backups (they age out under the 14-day retention already stated in the privacy notice), data export, taking a fresh backup first (an operator step in the runbook).

## One core, three triggers
`purgeWorkspace(deps, input, now)` in `src/features/organizations/server/purge-service.ts` is the only code that deletes. The triggers call it and add nothing of their own:

| Trigger | Who / how | Notes |
| --- | --- | --- |
| Admin console | Operator on `/admin`; types the workspace slug to confirm; server action | Uses the existing operator check (`require-operator.ts`); non-operators get 404. Actor = the operator. |
| CLI | `pnpm purge:workspace <slug>` run on the server | Actor: `audit_logs.actorId` is a UUID column, so it is null and `metadata.trigger` is `cli`. Prints the counts. |
| Worker | Sweep in `worker/main.ts`, same cadence style as the deadline sweep | Runs only when `AUTO_PURGE_ENABLED=true`; **default off**. Actor null, `metadata.trigger` is `worker`. Purges at most a few workspaces per sweep. |

The worker trigger reverses ADR-023's "no automatic purge". ADR-024 records why it is allowed (opt-in flag, off by default; the 14-day wait and the owner's cancel remain the safeguards) and what it costs (a stolen owner session plus 14 unnoticed days now loses the workspace without an operator looking).

## Rules the core re-checks (never trusting the trigger)
1. The organization exists and is not already purged.
2. `deletionRequestedAt` is set (the owner has not cancelled).
3. `now >= dueAfter(deletionRequestedAt)`.
Any failure throws an `AppError` and changes nothing. The organization id comes from the operator's choice of slug or the sweep's own query, never from a client-supplied `organizationId`.

## What the purge does
Order matters; each step is safe to repeat.

1. **File bytes.** List the workspace's `files` rows and delete each stored key; then sweep the `<organizationId>/` prefix through a new `StoragePort.deletePrefix` so bytes with no row are removed too. Bytes go first: if this fails, nothing in the database has changed and a retry resumes. Missing bytes are not an error.
2. **One database transaction** (`SET LOCAL app.purge_org = '<organizationId>'` first), deleting every row with this `organizationId`, children before parents, always filtered by `organizationId`: form submissions, appointment attendees, appointments, booking pages, forms, contact stage changes, consent events, CRM activities/deals/contacts, automation runs and rules, task due reminders, calendar feeds and connections, document chunks, knowledge documents, file shares, files, AI usage events, jobs, notifications, messages, channel members, channels, point events, challenges, task comments, tasks, milestones, goals, AI task plans, projects, invitations, members, subscription, audit logs. The final list is derived from the Prisma schema in the plan and checked by a test (below).
3. **Tombstone.** The `organizations` row stays: `name` and `slug` become `deleted-<id without hyphens>` (the first 12 characters of a UUIDv7 are a timestamp and can collide), `purgedAt` is set, `deletionRequestedBy` is cleared, other settings are reset. This keeps the final audit row's foreign key valid, avoids dropping constraints, and frees the old slug.
4. **Final audit event** `organization.purged` on the tombstone: actor, trigger (`admin`, `cli`, `worker`), counts per table, number of files removed. No names, emails or content.

Because the tombstone is set in the same transaction as the deletes, a purge either fully happens or not at all in the database; a crash before step 2 leaves a still-due workspace that a retry cleans.

## Getting past the append-only triggers
`point_events`, `consent_events` and `contact_stage_changes` reject UPDATE and DELETE. A new migration replaces the three trigger functions so a DELETE is allowed only when `current_setting('app.purge_org', true)` equals the row's `organizationId`; UPDATE stays rejected always. The setting is transaction-local (`SET LOCAL`), so it cannot leak to other queries on a pooled connection. No superuser rights and no disabling of triggers are needed. The migration documents its manual rollback (restore the old functions). Everyone else still cannot delete these rows.

## After the purge
- A purged workspace no longer resolves: members are gone, public booking pages, forms and feeds stop answering, `/admin` shows it as "Purged <date>" and hides the purge action.
- Schema change: `organizations.purgedAt timestamptz null`; list queries that show workspaces (admin) show purged ones separately.

## Errors, idempotency, concurrency
- A second purge call on a tombstone returns "already purged" without error to the CLI and admin UI.
- Two purges at once: the transaction starts by `SELECT ... FOR UPDATE` on the organization row and re-checks `purgedAt`; the second waits, then sees the tombstone.
- Jobs of the workspace are deleted in the same transaction; the queue's claim step already ignores jobs of organizations that no longer exist as active, and a test covers a job claimed mid-purge.

## Testing
Integration tests against the real database (the existing helpers), including cross-tenant negatives:
- Workspace A purged; workspace B's rows in every table (including the three append-only ones) are unchanged, and B's files remain.
- Every `organizationId` table has zero rows for A afterwards. A test enumerates tables with an `organizationId` column from `information_schema` and fails if the purge list misses one, so new tables cannot be forgotten.
- Refused: not yet due, request cancelled, never requested, already purged (no-op), unknown id.
- Operator-only: non-operator gets 404 on the action; the CLI path needs no session but is covered by a service-level test with actor `system:cli`.
- File bytes removed from the storage directory, including a stray file with no row.
- The append-only triggers still reject DELETE and UPDATE outside a purge, and a purge for A cannot delete B's rows even with A's setting.
- Re-run after a simulated failure (storage error in step 1; exception inside step 2 rolls back) completes the purge.
- Worker sweep does nothing when `AUTO_PURGE_ENABLED` is not `true`, purges a due workspace when it is, and skips a not-due one.
- Final audit event contains counts and no personal data.
- One Playwright test: operator purges a due workspace from `/admin`; its members can no longer open it.

## Documentation to update
`docs/08-ROADMAP.md`, `docs/13-PRODUCTION-READINESS.md` (blocker 8), `docs/12-OPERATIONS.md` (runbook: check the request, take a fresh backup, run the purge, confirm; flag setup), `docs/10-DECISIONS.md` (ADR-024), `docs/03-DATABASE.md` (`purgedAt`, trigger change, tombstone), `docs/07-SECURITY.md` (operator capability).

## Open points I decided by default (say if you disagree)
- The tombstone keeps the organization id forever; no personal data remains in it.
- The workspace's own audit logs are deleted except the final purge event.
- `AUTO_PURGE_ENABLED` is off in the VPS `.env` until you turn it on.
