# 06 — API & Server Contract Blueprint

## API principles
- Prefer server actions for first-party form mutations where appropriate; use Route Handlers for webhooks, streaming, integrations and public APIs.
- Every request has authenticated principal, resolved organization scope, validated input, and policy check.
- Return typed, structured errors; never reveal internal stack traces or another tenant's record existence.
- Use cursor pagination for long feeds; idempotency keys for retryable mutations.
- API paths below are **proposed** and not implemented.

## Implemented in Phase 0
| Method | Path | Purpose | Permission |
| --- | --- | --- | --- |
| GET/POST | `/api/auth/*` | Better Auth (sign-up/in/out, email verification, password reset, session) | public; Better Auth default rate limiting in production |
| GET | `/api/health` | Liveness + database readiness (`200` ok, `503` degraded) | public, no internals exposed |
| Server action | `createOrganizationAction` | Create organization; creator becomes `OWNER` | authenticated |

| Server action | `createProjectAction`, `archiveProjectAction` | Project create/archive | `project:create`, `project:archive` |
| Server action | `createGoalAction`, `archiveGoalAction` | Goal create/archive | `goal:create`, `goal:archive` |

| Server action | `createTaskAction`, `updateTaskAction`, `addCommentAction` | Task create, status/priority update, comment | `task:create`, `task:update`, `task:comment` |

| Page (server-rendered) | `/[locale]/w/[slug]` | Dashboard KPIs; filters via query string `projectId`, `assigneeId`, `range` (7/30/90/all) | `dashboard:read` |

Errors use `AppError` (`src/lib/errors.ts`) with the codes and statuses listed below.

## Proposed endpoints
| Method | Path | Purpose | Permission |
| --- | --- | --- | --- |
| GET | `/api/v1/organizations` | Membership workspaces | authenticated |
| POST | `/api/v1/organizations` | Create org | authenticated |
| GET | `/api/v1/orgs/:orgId/goals` | List goal tree | `goal:read` |
| POST | `/api/v1/orgs/:orgId/goals` | Create goal | `goal:create` |
| PATCH | `/api/v1/orgs/:orgId/goals/:id` | Update goal | `goal:update` |
| GET | `/api/v1/orgs/:orgId/tasks` | List tasks | `task:read` |
| POST | `/api/v1/orgs/:orgId/tasks` | Create task | `task:create` |
| PATCH | `/api/v1/orgs/:orgId/tasks/:id` | Update task | `task:update` |
| POST | `/api/v1/orgs/:orgId/invitations` | Invite member | `member:invite` |
| POST | `/api/v1/orgs/:orgId/ai/plan` | Generate draft plan | `ai:use` |
| POST | `/api/v1/orgs/:orgId/ai/plans/:id/apply` | Apply approved plan | `task:create` |
| GET | `/api/v1/orgs/:orgId/activity` | Activity feed | `activity:read` |

## Example — create task request
```json
{
  "goalId": "uuid",
  "title": "Create workspace dashboard",
  "priority": "HIGH",
  "status": "TODO",
  "assigneeId": "uuid",
  "dueAt": "2026-11-03T10:00:00Z"
}
```
Server resolves org membership independently of the supplied path id. Server validates assignee and goal against the same org.

## Example — successful response
```json
{
  "data": {
    "id": "uuid",
    "title": "Create workspace dashboard",
    "status": "TODO"
  }
}
```

## Error envelope
```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have access to this resource."
  }
}
```
Suggested statuses: 400 invalid shape, 401 unauthenticated, 403 forbidden, 404 inaccessible/nonexistent resource, 409 conflicts, 422 domain validation, 429 throttled.

## Real-time event design (later)
- `message.created`, `message.updated`, `task.updated`, `notification.created`.
- Authenticate connection and authorize every room join.
- Events include version, org scope, opaque event id and minimal payload.
- Reject client attempts to subscribe to arbitrary org or channel IDs.

## Webhooks
Verify provider signatures, validate timestamps and replay windows, persist receipt id, process asynchronously, respond idempotently.
