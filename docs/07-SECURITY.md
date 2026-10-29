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
- Tenant scope comes only from `getAuthorizedOrganization()` (`src/features/organizations/server/organization-service.ts`), which looks up an **ACTIVE** membership. Nonexistent, foreign and disabled-membership organizations all return `NOT_FOUND` (pages render 404).
- `src/proxy.ts` only negotiates locale; it is not an authorization layer.
- Better Auth: email verification required before sign-in, 12–128 character passwords, sessions revoked on password reset, 30-minute reset tokens, 24-hour verification tokens, 7-day sessions, httpOnly cookies (secure in production). Rate limiting is Better Auth's default: on in production only, in-memory.
- `EMAIL_TRANSPORT=log` writes auth emails (including links) to the server log (captured in memory under `NODE_ENV=test`) and is rejected when `NODE_ENV=production`.
- Logger (`src/lib/logger.ts`) redacts password, token, secret, cookie and authorization fields.
- Baseline response headers: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`. A Content Security Policy is still to be designed.
- Not yet in place: MFA/passkeys, distributed rate-limit storage (Better Auth uses in-memory storage by default, so limits are per process), PostgreSQL RLS (OD-02), secret scanning and dependency audit in CI.
