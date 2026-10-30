# 12 — Operations, Monitoring and Incident Procedures

How the platform is run once real tenants use it. Everything here is written for the people who operate the service, not for workspace members. Where a step needs infrastructure that is not chosen yet (OD-01 hosting, a monitoring vendor, a production email provider) the document says so instead of assuming it.

## Roles
- **Operator:** a person whose verified email is in `PLATFORM_ADMIN_EMAILS`. They can open `/admin`. Keep the list to the people who are on call. An operator is not a member of any workspace by virtue of being an operator.
- **Workspace owner/admin:** sees their own plan and usage at `/w/<slug>/billing`; cannot change the plan.

## The operator console (`/admin`)
- **Platform health (last 24 h):** workspaces, suspended workspaces, users and new users, queued jobs, how long the oldest due job has waited, failed jobs, stuck jobs (running with a lock older than 15 minutes), AI calls and AI errors. These are counts, never content.
- **Workspaces:** search by name or URL (100 rows at most), see plan, trial end, active members and AI tokens this month. Set a plan (optionally as a trial of 1–90 days) or switch the workspace off and on.
- Every change writes `billing.plan_changed`, `organization.suspended` or `organization.unsuspended` to that workspace's audit trail, with the operator as actor. Viewing the console is logged (operator id only).
- Setting a plan to **Unmetered** removes the subscription: the workspace has no plan limits (the state before billing existed).

## Plans (ADR-015)
Plans are set by hand. To move a customer: find the workspace, choose the plan, optionally a trial length, **Set plan**. The effect is immediate and needs no restart. Moving to a smaller plan never deletes data; see `07-SECURITY.md` for what stops working. A trial that ran out shows as "trial ended" and the workspace is on Free until the operator sets another plan.

## Signals to watch
There is no monitoring vendor yet. Until one is chosen, these are the signals, where to read them and when to act. All logs are structured JSON (pino) with a correlation id per request.

| Signal | Where | Act when |
| --- | --- | --- |
| App up and database reachable | `GET /api/health` (200 `ok`, 503 `degraded`) | two failed checks in a row, one minute apart |
| Job backlog | console: queued jobs and oldest due job | oldest due job waits more than 5 minutes |
| Worker dead | console: stuck jobs | any stuck job, or backlog growing with no jobs finishing |
| Failed jobs | console: failed jobs (24 h) | more than a handful, or any for one workspace repeatedly |
| AI provider trouble | console: AI errors against AI calls | errors above about 20 % of calls |
| Error rate | application logs, level `error` | a new error message repeating |
| Disk (file storage, database) | host | above 80 % |
| Realtime gateway | `GET /health` on the gateway port | not `ok` |

Alert delivery (paging) is **not set up**. Choosing a vendor and wiring these thresholds is a launch task (see `13-PRODUCTION-READINESS.md`).

## Incident procedure
1. **Declare.** Whoever notices opens an incident note (time, symptom, who is looking). One person is incident lead; others do not make changes without telling the lead.
2. **Classify.**
   - **SEV1:** possible exposure of one tenant's data to another, a leaked secret, or the service down for everyone.
   - **SEV2:** one feature or one tenant is down or badly degraded; data is safe.
   - **SEV3:** a bug with a workaround.
3. **Contain first, then diagnose.**
   - Suspected cross-tenant exposure or abusive tenant: **suspend the workspace(s)** in `/admin` (reversible, deletes nothing, stops access, public links, the calendar feed, realtime and downloads).
   - Leaked secret: rotate it (`BETTER_AUTH_SECRET` invalidates sessions; `REALTIME_PUBLISH_SECRET` must change on app and gateway together; the AI and Turnstile keys at their providers), then redeploy.
   - Bot abuse on public forms: enable Turnstile (`TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY`), or unpublish the page.
4. **Diagnose** with the correlation id from the user's report or the failing log line. The audit trail (`audit_logs`) answers "who changed what, when" per workspace.
5. **Recover** with the runbook below, then confirm: health check green, backlog draining, a test sign-in works.
6. **Tell people.** SEV1: affected workspace owners are told what happened and what data was involved, and the legal/privacy contact decides on regulator notification (the clock for personal-data breaches is short; decide who that contact is before launch). SEV2: a short status note.
7. **Review within five working days:** timeline, cause, what detected it, what would have detected it sooner, follow-up tickets with owners. No blame; fix the system.

## Runbooks
**Health check returns 503.** The database is unreachable. Check the database host and its connection limit, then the app's `DATABASE_URL`. The app recovers on its own once the database is back; there is no state in the app process that needs repair.

**Jobs are stuck or the backlog grows.** Restart the worker (`pnpm worker`). A job that was running when the worker died goes back to the queue once its lock is older than 5 minutes, as soon as a worker runs again (its attempt still counts). If one job type fails repeatedly, read `jobs.lastError` for that workspace (the error text, never the content); failed jobs stay in the table for inspection. Document indexing failures only affect search for that file.

**AI answers fail.** Check the console's AI errors, then the provider status. The planner and the assistant fail closed (an error message, no partial change). Setting a workspace's daily budget to 0 switches AI off for that workspace only.

**A workspace owner says they are locked out of a plan limit.** Open the console, read plan and usage, and either explain the limit or set a different plan. Remember a pending invitation holds a seat.

**A workspace must be taken offline** (abuse, legal request): suspend it. To bring it back, restore it. Neither deletes data.

**Realtime is down.** The product still works; pages need a refresh to show new messages. Restart `pnpm gateway`; clients reconnect and re-authorize every join.

## Backup and restore
- **What must be backed up together:** the PostgreSQL database **and** the file storage directory (`STORAGE_DIR`, or the object store once OD-04 is decided). A database restored without the files has file rows with no bytes; the reverse leaves orphan bytes.
- **Rehearsal (`pnpm rehearse:restore`):** builds a three-tenant data set with real stored files, takes a cold copy of the database directory and the file directory, destroys the originals, restarts from the copy, and fails unless every table's row count, the migration history, every file's content hash and the per-tenant task/file counts are identical. Latest local run: PASS (38 tables, 99 rows, 18 migrations, 9 files, 3 tenants, restart and verification in under a second; the data set is tiny, so the time says nothing about production).
- **What the rehearsal does not cover:** hot backups taken while the system is running (`pg_dump` or continuous archiving), point-in-time recovery, restoring into the real hosting, and the file store being a different system. Those need the production environment. Before launch someone must (a) choose the backup mechanism with the host (OD-01), (b) set retention, (c) run a restore into a clean environment from an actual backup, run `pnpm db:deploy` and the verification above against it, and (d) write down the measured recovery time and the maximum data loss the backup interval implies. Until then, no recovery-time or recovery-point promise should be made to customers.
- **Order when restoring:** database first, then files, then start the app; run `pnpm db:deploy` (it is a no-op when migrations are current), then spot-check one tenant.

## Deploying and rolling back
- Apply migrations with `pnpm db:deploy` before starting the new version. Each migration notes its manual rollback SQL; most are additive, so rolling the application back to the previous version with the new schema in place is safe.
- Rolling back the billing migration (`20261030130000_billing`) means dropping `subscriptions` and `organizations.suspendedAt`; do it only after rolling the application back first.
- The app refuses to start in production with `EMAIL_TRANSPORT=log`. There is no real email transport yet, so **a production start is not possible until one is added** (a launch blocker, listed in `13-PRODUCTION-READINESS.md`).

## Environment variables added in Phase 5
`BILLING_ENABLED` (default `false`), `BILLING_TRIAL_DAYS` (default 14, 1–90), `PLATFORM_ADMIN_EMAILS` (comma-separated; empty means nobody can open `/admin`).
