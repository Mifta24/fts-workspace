# 03 — Proposed Database Design

**Status:** logical model. The executable Phase 0 subset is `prisma/schema.prisma`: `users`, `sessions`, `accounts`, `verifications` (Better Auth core), `organizations`, `members` (`role` OWNER…VIEWER, `status` ACTIVE/DISABLED, unique `(organizationId, userId)`), and `audit_logs`. All ids are UUIDs (Better Auth `generateId: "uuid"`, app tables `uuid(7)`). Organization tables are app-owned (ADR-008); `role_grants` and `invitations` are deferred to Phase 1.

## Conventions
- Prefer UUID identifiers; `createdAt`, `updatedAt`, optional `deletedAt`.
- Every organization-owned record contains `organizationId` (or inherits it through a proven, enforced owner relationship).
- Use composite unique constraints scoped to organization for slugs and human-readable identifiers.
- Prefer enum/check constraints for stable status values.
- Store timestamps in UTC, render in user timezone.

## Core entities
| Domain | Proposed tables | Key relationships |
| --- | --- | --- |
| Auth | `users`, `sessions`, `accounts`, `verifications` | Adapter-owned schema |
| Tenant | `organizations`, `members`, `invitations`, `role_grants` | User M:N organization |
| Productivity | `projects`, `goals`, `milestones`, `tasks`, `task_comments`, `task_dependencies` | Project → goal tree → tasks |
| Collaboration | `channels`, `channel_members`, `messages`, `message_reads`, `notifications` | Org-scoped channels; DM membership |
| Gamification | `point_events`, `challenges`, `challenge_progress`, `achievements`, `streaks` | Append-only point ledger |
| Knowledge | `knowledge_bases`, `documents`, `document_chunks`, `file_objects` | Org-scoped retrieval and ACL |
| CRM | `crm_contacts`, `crm_deals`, `crm_activities`, `appointments`, `customer_journeys` | Contact → deals & activities |
| AI | `ai_threads`, `ai_messages`, `ai_tool_calls`, `ai_usage_events` | User / organization / tool audit |
| Automation | `workflows`, `workflow_versions`, `workflow_runs`, `workflow_steps` | Versioned definitions & execution |
| SaaS | `plans`, `subscriptions`, `entitlements`, `usage_records` | Plan → organization |
| Governance | `audit_logs`, `outbox_events`, `webhook_receipts` | Immutable event trail |

## Important model examples
### `goals`
`id`, `organizationId`, `projectId?`, `parentGoalId?`, `title`, `description?`, `status`, `progressMode`, `targetValue?`, `currentValue?`, `ownerId`, `dueAt?`, timestamps.

### `tasks`
`id`, `organizationId`, `projectId?`, `goalId?`, `parentTaskId?`, `title`, `description?`, `status`, `priority`, `assigneeId?`, `createdById`, `startsAt?`, `dueAt?`, `completedAt?`, timestamps.

### `ai_tool_calls`
`id`, `organizationId`, `threadId`, `requestedById`, `toolName`, `redactedArguments`, `approvalStatus`, `approvedById?`, `executedAt?`, `resultStatus`, timestamps. Avoid storing secrets or unnecessary personal data.

## Tenant integrity
- Query and mutate by `organizationId` plus record identifier.
- Validate foreign keys target the same organization. Where supported, use composite FKs/unique keys to enforce this in DB, not only application logic.
- Membership belongs to `(organizationId, userId)` with uniqueness.
- A goal/task parent must be in the same organization and parent-cycle creation must be rejected transactionally.
- Do not hard-delete audit or financial usage history in ordinary UI flows.

## Index plan
- `tasks(organizationId, status, dueAt)`
- `tasks(organizationId, assigneeId, status)`
- `goals(organizationId, parentGoalId)`
- `messages(organizationId, channelId, createdAt)`
- `notifications(organizationId, userId, readAt)`
- `ai_usage_events(organizationId, createdAt)`
- add search-specific indexes after profiling.

## Migration order
1. Auth adapter + organization/membership.
2. Projects, goals, tasks and comments.
3. Notifications, outbox, audit.
4. Chat and gamification.
5. Knowledge/AI, CRM, billing.

## Safety checks
Test invalid parent chains, tenant-spanning assignees, duplicate invitations, concurrency on task completion, and direct-object lookup from another organization.

## Implemented in Phase 0
Executable schema: `prisma/schema.prisma`; migrations in `prisma/migrations/`.

| Table | Owner | Notes |
| --- | --- | --- |
| `users`, `sessions`, `accounts`, `verifications` | Better Auth (Prisma adapter) | UUIDv7 ids (Prisma default); passwords hashed in `accounts.password` |
| `organizations` | `src/features/organizations` | globally unique `slug` |
| `members` | `src/features/organizations` | unique `(organizationId, userId)`; `role` enum `OWNER/ADMIN/MANAGER/MEMBER/VIEWER`; `status` `ACTIVE/DISABLED` |
| `audit_logs` | `src/server/services/audit.ts` | append-only; `organizationId` FK is `RESTRICT` so tenant deletion cannot silently drop audit history |

The Better Auth organization plugin tables (`invitation`, `session.activeOrganizationId`) are intentionally absent (ADR-008). Invitations arrive in Phase 1.

### Added in Phase 1, slice 1
| Table | Notes |
| --- | --- |
| `projects` | `status` ACTIVE/ARCHIVED; unique `(id, organizationId)` is the target of composite FKs |
| `goals` | composite FKs `(projectId, organizationId)` and `(parentGoalId, organizationId)` make cross-tenant references impossible in the database; CHECKs for progress 0-100, positive target, no self-parent. Parent-cycle and depth (max 10) checks run in `goal-service` under a per-organization advisory lock. Archive-only, no hard delete. |

| `tasks` | composite FKs to `projects`, `goals` and parent `tasks`; CHECKs: no self-parent, `completedAt` set exactly when `status = COMPLETED`, `startsAt <= dueAt`. Subtask cycles and depth (max 5) are checked in `task-service` under a per-organization advisory lock, which also serializes completion. Assignee must be an ACTIVE member (service). Cancel instead of delete. |
| `task_comments` | composite FK `(taskId, organizationId)`; append-only; body never copied into audit logs |

| `milestones` | composite FK `(goalId, organizationId)`; `completedAt` set when done; drives `MILESTONE_BASED` progress; hard-deleted with its goal |
| `ai_task_plans` | composite FK to the goal; `draft` JSON holds validated suggestions only; `status` DRAFT/APPLIED/DISCARDED (applied exactly once via a conditional update); private to `requestedById`; objective text is stored, never copied to audit logs |

| `invitations` | `email` stored lowercase; `tokenHash` = SHA-256 of a 32-byte random token (the token only exists in the email); `expiresAt` 7 days; `acceptedAt`/`revokedAt`; CHECKs: role is never OWNER, email lowercase, not both accepted and revoked; a **partial unique index** allows one pending invitation per `(organizationId, email)` |

| `channels` | `type` CHANNEL/DM; CHECK ties name/`dmKey`/privacy to the type; DMs are private and unique per user pair via `dmKey`; `(organizationId, name)` unique |
| `channel_members` | composite FK `(channelId, organizationId)`; membership decides read/post for **every** channel (public channels are self-joined); `lastReadAt` drives unread counts |
| `messages` | composite FK to the channel; cursor pagination index `(organizationId, channelId, createdAt, id)`; soft delete (body blanked, CHECK) |
| `notifications` | references what happened (`type`, `resourceType`, `resourceId`, `actorId`) with no content; coalesced to one unread per recipient/type/resource |

| `point_events` | **append-only** (trigger rejects UPDATE/DELETE); unique `(organizationId, userId, type, sourceId)` = one award per task and user; `organizationId` FK is `RESTRICT`; points 1–100 |
| `challenges` | window and target CHECKs; progress is computed from the ledger, never stored |
| `organizations.leaderboardVisibility` | `OFF` (default) / `OPT_IN` |
| `members.showOnLeaderboard` | default `false`; each person decides |

| `files` | metadata only; bytes live in the storage adapter under a server-generated `storageKey` (`<organizationId>/<uuid>`); `visibility` PRIVATE/SHARED/ORGANIZATION; sha256 checksum; 10 MB CHECK; `DELETED` rows keep metadata for the audit trail while the bytes are removed |
| `file_shares` | composite FK `(fileId, organizationId)`; unique `(fileId, userId)` |

| `knowledge_documents` | one per indexed file (unique `fileId`); **no ACL of its own** — access follows the file at query time; status PENDING/INDEXED/FAILED |
| `document_chunks` | passages (≤ 800 chars, ≤ 500 per file); `tsv` is a **generated** `to_tsvector('simple', content)` column with a GIN index (SQL-only, invisible to Prisma) |
| `jobs` | database job queue: claimed with `FOR UPDATE SKIP LOCKED`, retries with exponential backoff (30 s, 60 s…), `maxAttempts` 3, idempotent via unique `(organizationId, dedupeKey)` |

| `ai_usage_events` | one row per model call (user, feature, provider, model, status, tokens, whether estimated, latency); never prompts or answers; `RESTRICT` on the organization |
| `organizations.aiDailyTokenBudget` | default 200,000 tokens per UTC day; 0 switches AI off |

| `crm_contacts` | personal data of external people; unique `(organizationId, email)` among non-erased rows (SQL partial index); CHECK: erased rows hold no email/phone/company; `consentStatus` mirrors the latest `consent_events` row |
| `consent_events` | **append-only** (trigger) proof of each consent decision and its basis |
| `crm_deals` | composite FK to the contact; amount in minor units with an ISO currency; CHECK: `closedAt` is set exactly for WON/LOST |
| `crm_activities` | notes/calls/emails/meetings on a contact (optionally a deal of the same contact); body ≤ 2000, blanked on erasure |

Migrations `20261029120000_crm`, `20261029110000_ai_usage`, `20261029100000_knowledge_jobs`, `20261029090000_files`, `20261029030000_projects_goals`, `20261029040000_tasks`, `20261029050000_milestones_ai_plans`, `20261029060000_invitations`, `20261029070000_chat_notifications` and `20261029080000_engagement`. Streaks are derived from award days, not stored. The partial unique index on `invitations` is written in SQL only (Prisma cannot express it), so `prisma migrate dev` may report it as drift; `migrate deploy` is unaffected. Do not drop it when regenerating migrations. Task-based goal progress = completed / non-cancelled tasks linked to the goal. Migration `20261029030000_projects_goals` (rollback SQL noted at its end). Owner membership is validated in the service, not by FK.

### Seed strategy
- `pnpm db:seed` runs `prisma/seed.ts`; it refuses to run with `NODE_ENV=production`.
- The seed creates two demo tenants (`acme`, `globex`) and three verified demo users for manually checking tenant isolation. Passwords are hashed with Better Auth's `hashPassword`. The dev-only password comes from `SEED_PASSWORD` or a default in `prisma/seed.ts`.
- Integration tests create their own fixtures and truncate tables in a database whose name must contain `_test`.
