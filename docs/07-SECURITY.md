# 07 — Security & Privacy Requirements

## Threat model highlights
Attackers may be unauthenticated external users, compromised members, malicious third-party integrations, or poisoned AI documents. High-value targets include tenant isolation, account access, attachments, AI tools and subscription billing.

## Authentication & sessions
- Use vetted Better Auth integration; confirm exact schema/API versions.
- Secure, httpOnly session cookies over HTTPS, short-lived sensitive actions, rotation/revocation.
- Email verification and account recovery with token expiry and rate limits.
- MFA/passkeys considered for privileged roles.

## Authorization
- Enforce permissions on server actions, route handlers, files, jobs, search and realtime channels.
- Membership checks must use canonical DB records, not client-controlled organization selectors.
- Default-deny permission matrix; avoid `OWNER` bypass of security-critical safeguards.
- Write negative tests against another organization and a disabled membership.

## Tenant boundaries
- Scope list queries and direct lookup by organization.
- Validate parent/child foreign references and assignees within tenant.
- Consider PostgreSQL row-level security as defense-in-depth when execution context is robust.
- Never let shared caches mix tenant contents; use tenant-qualified cache keys and invalidate safely.

## Files
- Private buckets only; signed download URLs; uploads with content-type/size limits.
- Malware scanning where needed; no execution of uploaded content.
- Restrict document ingestion and AI retrieval by ACL, including derived chunks/embeddings.

## AI security
- Prompt injection defense: external content is untrusted data.
- AI tools use narrow input schemas and the same auth policy as UI actions.
- Require approvals for bulk changes, external messages, deleting data, purchasing, and permission changes.
- Redact PII and secrets in logs; track tool calls and cost.
- Set per-user/org rate and spend budgets.

## Infrastructure
- TLS, secrets management, network segregation, image patching and dependency scans.
- Postgres not public; Redis authenticated/private; LM Studio endpoint private.
- Automated encrypted backups; documented and tested restore procedure.
- Monitoring alerts for auth anomalies, failed jobs, quota spikes, and cross-tenant attempts.

## Governance and privacy
- Data minimization, documented retention periods, deletion/export procedures, breach response.
- Ensure legal basis/consent for CRM and recordings; avoid transferring private reference-account data into development.
- Never embed passwords, one-time codes, session cookies, or private account screenshots in repository.

## Release security gate
Auth tests + RBAC matrix tests + cross-tenant E2E + secret scan + dependency audit + backup restore + basic abuse/rate-limit checks.

## Phase 0 implementation notes
**Permission matrix** (`src/lib/permissions/matrix.ts`, default deny):

| Permission | OWNER | ADMIN | MANAGER | MEMBER | VIEWER |
| --- | --- | --- | --- | --- | --- |
| `organization:read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `organization:update` | ✓ | ✓ | | | |
| `organization:delete` | ✓ | | | | |
| `member:read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `member:invite` | ✓ | ✓ | | | |
| `member:update-role` | ✓ | ✓ | | | |
| `member:remove` | ✓ | ✓ | | | |
| `audit:read` | ✓ | ✓ | | | |

- Phase 1 slice 1 adds `project:read|create|update|archive` and `goal:read|create|update|archive`: everyone reads; `goal:create/update` for OWNER, ADMIN, MANAGER, MEMBER; `goal:archive` and all project writes for OWNER, ADMIN, MANAGER; VIEWER is read-only. Services take the server-resolved `OrganizationContext`, query by `organizationId` + id, and answer foreign ids with `NOT_FOUND`. Actions resolve the tenant from the slug via `requireWorkspace()`.
- Tasks add `task:read` (all roles) and `task:create|update|comment` (OWNER, ADMIN, MANAGER, MEMBER); VIEWER is read-only. Assignees are validated as ACTIVE members of the same organization, and comment bodies are excluded from audit metadata.
- `dashboard:read` is granted to every role; the dashboard service also requires `goal:read` and `task:read`, scopes every aggregate by `organizationId`, and a foreign `projectId`/`assigneeId` filter matches nothing.
- Goal status `ARCHIVED` cannot be set through `updateGoal` (the schema rejects it): archiving always goes through `archiveGoal`, which needs `goal:archive` and checks for active subgoals. Archived goals are read-only.
- AI planning (`ai:use`: OWNER, ADMIN, MANAGER, MEMBER): the model receives only the goal title, description and the user's objective, with a system prompt that marks them as data; output is parsed with a strict Zod schema (unknown keys such as assignees, status or roles are dropped, 1–15 tasks). A draft never mutates tasks: `applyPlan` re-validates the reviewed selection, claims the plan with a conditional update (no double apply), creates unassigned TODO tasks and audits counts only. Plans are visible only to their requester. A per-user budget of 10 plans per hour applies (best-effort, not a hard concurrency guarantee). Provider errors are logged without prompts or answers. Not yet in place: spend/usage ledger, per-organization budgets.
- Milestone changes need `goal:update`; archived goals are read-only.
- Invitations: 256-bit random token, stored only as a SHA-256 hash, single use (claimed with a conditional update), 7-day expiry, bound to one lowercase email and one role. OWNER cannot be granted by invitation (service and database CHECK). Accepting requires a verified session whose email equals the invited one. Unknown, used, revoked and expired tokens return the same "unavailable" result; the public preview shows only the organization name, role and a masked email. A disabled member is never re-enabled by an invitation. Pending invitations are capped at 100 per organization. Emails use the same `log` transport as auth emails, so no real invitation mail is sent until a provider is chosen. Member email addresses are shown only to roles with `member:invite`. Not yet in place: rate limiting of preview/accept attempts (relies on the token's entropy), role changes and member removal.
- Chat: `chat:read` (all roles), `chat:post` (OWNER, ADMIN, MANAGER, MEMBER), `chat:manage` (create channels, add members: OWNER, ADMIN, MANAGER), `chat:moderate` (OWNER, ADMIN). **Membership of the channel is required for every read and write**, including public channels (join is explicit); non-members, private channels and other people's DMs all answer `NOT_FOUND`. Authors may edit for 15 minutes and delete their own messages; moderators may delete in public channels and in private channels they belong to, never in DMs. 20 messages per minute per author. Message bodies are rendered as plain text (no HTML/markdown). Audit trail: channel creation, member additions and deletions (never message text). Realtime events (`src/server/realtime/publisher.ts`) carry identifiers only and are best-effort after commit.
- Notifications are created in the originating transaction for active members only, never for one's own actions, and carry no content; they are listed and marked read per user within the organization.
- Realtime gateway: unauthenticated handshakes are refused; the user id comes only from the verified session (Better Auth, via the app); `organizationId` is never taken from the client, only resolved from the slug against ACTIVE memberships; each `join` requires channel membership, and every refusal (no org, no channel, not a member, private, other tenant, malformed id) gets the identical `{ok:false}`. Limits: 10 organizations and 50 channel rooms per socket, 60 actions per minute, 10 KB message buffer, strict Zod validation. Memberships are re-checked every 60 s and revoked access emits `revoked` and removes the rooms. CORS allows one origin with credentials. The publish endpoint needs a 32+ character shared secret (timing-safe comparison), 4 KB bodies and schema-valid identifier-only events. Not yet in place: gateway rate limiting per IP, TLS termination guidance beyond the reverse proxy, Redis adapter for multiple instances, presence and typing indicators (not built).
- Points and rankings: `gamification:read` (all roles; each person only reads their own numbers), `challenge:manage` (OWNER, ADMIN, MANAGER), leaderboard policy needs `organization:update`. Points are appended in the same transaction as the task completion and its audit event, only to the assignee who completes their own assigned task, with anti-farming limits (nothing for self-created tasks finished within 10 minutes, at most 10 awards per UTC day, one award per task ever); the ledger is append-only in the database. The leaderboard is **off by default**, only lists members who opted in (admins cannot see others' points either), is scoped to active members of the organization, and excludes email addresses. Points are a recognition metric only: no balance, spending or rewards exist, and none should be added without a separate review. Not yet in place: awards for milestones or goals, team challenges, and reversal of awards when a completion is later found to be wrong (needs a compensating-entry design, since the ledger cannot be edited).
- Files: `file:read` (all), `file:upload` (OWNER, ADMIN, MANAGER, MEMBER), `file:delete-any` (OWNER, ADMIN). **Access rule** (`fileAccessWhere`): the uploader, or ORGANIZATION visibility, or an explicit share, inside the same organization and `READY`; admins get no implicit read access to private files (they may delete them for moderation, audited as `moderated`). Everything else answers `NOT_FOUND`. Uploads: 10 MB per file, 200 MB per workspace, an allowlist of text/markdown/csv/pdf/png/jpeg/webp **verified by content** (magic bytes; text must be valid UTF-8 without NUL), no SVG/HTML/office formats, display names sanitized, storage keys server-generated and path-validated, never served statically. Downloads are always attachments with `nosniff` and a sandbox CSP, `Cache-Control: private, no-store`, and need a session plus a 5-minute HMAC signature bound to file and user, plus the access rule; checksum verified on read. Origin is checked on upload. Not yet in place: malware scanning (a hook point is needed before accepting untrusted external uploads), encryption at rest beyond the disk's, retention/purge jobs.
- Knowledge: `knowledge:read` (all roles), `knowledge:manage` (OWNER, ADMIN, MANAGER, MEMBER; only for your own files). Retrieval applies the **file access rule inside the SQL query** (organization, `READY`, uploader / ORGANIZATION / share), so passages the caller may not read are never selected, ranked or returned, and cannot reach a prompt; because documents hold no ACL copy, sharing, unsharing, visibility changes and deletion apply on the very next search. A test asserts the SQL predicate and `fileAccessWhere` agree for every combination. The query text is bound as data to `websearch_to_tsquery`. Ingestion runs in the worker: it takes the organization from the job row (never from the payload), re-checks the file state and checksum, and stores no document text in errors or job rows. Indexed text is untrusted content: anything that later puts passages into a prompt must label them as data. Not yet in place: semantic retrieval, PDF/office text extraction, malware scanning before indexing, per-organization indexing quotas.
- Assistant and AI metering: every model call goes through `runMeteredCompletion`: hourly request cap per person (30, all AI features together), daily token budget per organization (default 200,000; 0 disables), usage ledger rows with numbers only (provider-reported tokens, else an estimate of characters / 4). Failed provider calls are recorded and count against the caps. The assistant retrieves only passages the asker may read (access rule inside the query), sends nothing when there are none, labels sources and the question as data in the system prompt, shows output as plain text and keeps only citations that point at supplied sources. Audit events carry counts, never text. Known limits: the daily budget check uses a prompt-size estimate before the call and the real count after, so concurrent calls can overshoot slightly; budgets are per organization, not per user.
- CRM and privacy: `crm:read`/`crm:write` (OWNER, ADMIN, MANAGER, MEMBER), `crm:read-all` (OWNER, ADMIN, MANAGER), `crm:erase` (OWNER, ADMIN); **viewers have no CRM access** (the data is personal data of third parties). Members see and change only contacts they own (and deals through those contacts or that they own); managers and above see all and may reassign. Consent: every grant or withdrawal needs a stated basis and is stored in an append-only history; consent is **recorded, not enforced** (nothing in the product sends marketing messages yet). Erasure anonymizes the contact and blanks its activity text while keeping deals, consent proof and reports (the database refuses PII on an erased row). Audit trail and logs carry identifiers and counts, never names, emails, phone numbers or note text. Pipeline values are summed per currency only. Search escapes LIKE wildcards. Not yet in place: data-subject export, retention schedules, per-field encryption, import/export, and a documented lawful-basis register; these need the operator's legal review before real customer data is stored.
- Tenant scope comes only from `getAuthorizedOrganization()` (`src/features/organizations/server/organization-service.ts`), which looks up an **ACTIVE** membership. Nonexistent, foreign and disabled-membership organizations all return `NOT_FOUND` (pages render 404).
- `src/proxy.ts` only negotiates locale; it is not an authorization layer.
- Better Auth: email verification required before sign-in, 12–128 character passwords, sessions revoked on password reset, 30-minute reset tokens, 24-hour verification tokens, 7-day sessions, httpOnly cookies (secure in production). Rate limiting is Better Auth's default: on in production only, in-memory.
- `EMAIL_TRANSPORT=log` writes auth emails (including links) to the server log (captured in memory under `NODE_ENV=test`) and is rejected when `NODE_ENV=production`.
- Logger (`src/lib/logger.ts`) redacts password, token, secret, cookie and authorization fields.
- Baseline response headers: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`. A Content Security Policy is still to be designed.
- Not yet in place: MFA/passkeys, distributed rate-limit storage (Better Auth uses in-memory storage by default, so limits are per process), PostgreSQL RLS (OD-02), secret scanning and dependency audit in CI.
