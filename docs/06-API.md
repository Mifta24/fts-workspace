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

| Server action | `updateProjectAction`, `updateGoalAction` | Edit project / goal (empty description or due date clears it) | `project:update`, `goal:update` |
| Page | `/[locale]/w/[slug]/projects/[id]`, `/goals/[id]` | Edit forms; `NOT_FOUND`/`FORBIDDEN` render 404 | `project:update`, `goal:update` |

| Server action | `addMilestoneAction`, `toggleMilestoneAction`, `deleteMilestoneAction` | Milestones of a goal | `goal:update` |
| Server action | `generatePlanAction`, `applyPlanAction`, `discardPlanAction` | AI task plan: generate draft, apply reviewed selection, discard | `ai:use` (+ `task:create` to apply) |
| Page | `/[locale]/w/[slug]/goals/[id]/plan`, `.../plan/[planId]` | Objective form and draft review | `ai:use` |

| Server action | `inviteMemberAction`, `revokeInvitationAction` | Create / revoke an invitation (emails the link) | `member:invite` |
| Server action | `acceptInvitationAction` | Accept an invitation as the signed-in, verified user | authenticated; email must match |
| Page | `/[locale]/invite/[token]` | Public preview (masked email), accept or sign-in prompt | public |
| Page | `/[locale]/w/[slug]/members` | Member list; invitations for admins | `member:read` (`member:invite` for invitations and emails) |

| Server action | `createChannelAction`, `joinChannelAction`, `startDirectMessageAction`, `postMessageAction`, `editMessageAction`, `deleteMessageAction`, `markChannelReadAction` | Chat | `chat:manage`, `chat:read`, `chat:post` (+ channel membership) |
| Server action | `markNotificationReadAction`, `markAllNotificationsReadAction` | Inbox | `notification:read` (own notifications only) |
| Page | `/[locale]/w/[slug]/chat`, `/chat/[channelId]?before=<messageId>`, `/notifications` | Chat (cursor pagination, 30 per page), inbox | `chat:read`, `notification:read` |

| Socket.IO (gateway) | `subscribe {organizationSlug}`, `join {organizationSlug, channelId}`, `leave` | Authorized per call; ack `{ok}` with the same answer for every refusal | session cookie + active membership (+ channel membership) |
| Socket.IO events | `message.created`, `message.updated` `{channelId, messageId}`, `notification.created` `{notificationId}`, `revoked` | Identifiers only; fetch content through the normal authorized pages | joined rooms |
| HTTP (gateway, internal) | `POST /internal/publish`, `GET /health` | App → gateway fan-out (4 KB limit, shared secret); liveness | secret / public |
| HTTP | `GET /api/realtime/session` | Gateway asks which user a cookie belongs to | session |

| Server action | `createChallengeAction`, `archiveChallengeAction` | Challenges | `challenge:manage` |
| Server action | `setLeaderboardOptInAction`, `setLeaderboardVisibilityAction` | Own opt-in; organization policy | `gamification:read` (own); `organization:update` |
| Page | `/[locale]/w/[slug]/progress?range=week|month|all` | Own points, streak, challenges, leaderboard | `gamification:read` |

| POST | `/api/files` (multipart: `file`, `visibility`, `organizationSlug`) | Upload (route handler, no 1 MB action limit; Origin check) | `file:upload` |
| GET | `/api/files/:id/content?org=&exp=&sig=` | Download as attachment; needs session, a 5-minute signature bound to file and person, and the access rule | `file:read` |
| Server action | `deleteFileAction`, `setVisibilityAction`, `shareFileAction`, `unshareFileAction` | File management (uploader; `file:delete-any` for deletion) | see 07-SECURITY |

| Server action | `requestIndexingAction`, `removeFromKnowledgeAction` | Add / remove one of your own text files | `knowledge:manage` |
| Page | `/[locale]/w/[slug]/knowledge?q=` | Search (min. 2 chars) and indexed files | `knowledge:read` |

| Server action | `askAction`, `setBudgetAction` | Ask the knowledge assistant; set the daily token budget | `ai:use`; `organization:update` |
| Page | `/[locale]/w/[slug]/assistant` | Question box, answer with sources, today's usage | `ai:use` |

| Server action | `createContactAction`, `updateContactAction`, `recordConsentAction`, `setJourneyStageAction`, `createDealAction`, `moveDealAction`, `addActivityAction` | CRM writes | `crm:write` (+ contact access) |
| Server action | `eraseContactAction` | Erase a contact's personal data | `crm:erase` |
| Page | `/[locale]/w/[slug]/crm`, `/crm/[contactId]`, `/crm/pipeline` | Contacts, detail with consent/deals/activity, pipeline report | `crm:read` |

| Server action | `createAppointmentAction`, `rescheduleAction`, `cancelAction` | Meetings (organizer) | `appointment:write` |
| Server action | `respondAction` | Accept / decline an invitation | attendee |
| Server action | `createBookingPageAction`, `updateBookingPageAction`, `setBookingPageStatusAction` | Own booking pages | `booking:manage` (owner of the page only) |
| Page | `/[locale]/w/[slug]/booking`, `/booking/[pageId]` | List, create, publish and edit the caller's booking pages | `booking:manage` |
| Page + server action (**public, no session**) | `/[locale]/b/[token]`, `bookSlotAction` | Free slots of a published page and the booking itself; unknown, draft, closed and ownerless pages give 404 | public (token) |
| Server action | `createFeedAction`, `revokeFeedAction` | Create (and replace) or turn off the caller's calendar subscription link; the link is returned once | `appointment:read` |
| Route (**public, no session**) | `GET /api/calendar/<token>[.ics]` | Read-only iCalendar feed of the token owner's meetings (`text/calendar`, `private, no-store`); unknown, revoked and malformed tokens give the same empty 404 | secret token |
| Server action | `setTimeZoneAction` | Choose your own time zone for meeting times | `appointment:read` |
| Page | `/[locale]/w/[slug]/schedule` | Your meetings for the next 60 days (times in your own time zone, UTC by default) | `appointment:read` |

| Server action | `createFormAction`, `updateFormAction`, `updateFormFieldsAction`, `setFormStatusAction` | Form management | `form:manage` |
| Page | `/[locale]/w/[slug]/insights` | Counts for contacts and consent, forms and the caller's own meetings; `?days=7|30|90` (anything else means 30) | `dashboard:read` (sections need their own permission) |
| Page | `/[locale]/w/[slug]/forms`, `/forms/[formId]` | List, templates, publishing, submissions | `form:manage` |
| Page + server action (**public, no session**) | `/[locale]/f/[token]`, `submitFormAction` | Anonymous form and submission; unknown/draft/closed tokens give 404 | public (token) |

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
