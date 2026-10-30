# 04 — Feature Specifications

## Classification
- **MVP:** needed for first pilot.
- **Next:** prioritized expansion.
- **Later:** roadmap concept pending validation.

| Domain | Feature | Release | Main capability |
| --- | --- | --- | --- |
| Identity | Authentication | MVP | Sign up/in/out, recovery, sessions |
| Organization | Workspace membership | MVP | Invite, roles, switch, isolate |
| Goals | Goal tree | MVP | Nested goals, milestones, progress |
| Tasks | Task management | MVP | CRUD, assignee, status, due dates |
| Dashboard | Overview | MVP | Personal/team progress widgets |
| AI | Goal task planner | MVP | Suggested tasks, review then save |
| Collaboration | Channels & DM | Next | Searchable org-scoped chat |
| Notifications | Inbox | Next | Assignment, mention and deadlines |
| Engagement | Challenges/XP | Next | Ledger-based progress, rankings |
| Knowledge | Documents/Drive | Next | Private files, document search |
| AI | Knowledge Q&A/tools | Next | ACL-aware retrieval and actions |
| Business | CRM & scheduling | Later | Leads, deals, appointment booking |
| Operations | Analytics/forms | Later | Reports, configurable data capture |
| Automation | Workflows/MCP | Later | User-approved integration actions |
| Platform | Billing & entitlements | Phase 5 (no payments yet) | Plans, limits, usage accounting; plans set by an operator, see ADR-015 |
| Ecosystem | Virtual space & recording | Optional | Validate demand before building |

## MVP feature contracts
### Organization
- Owner creates workspace and invites members via expiring invite.
- Roles: `OWNER`, `ADMIN`, `MANAGER`, `MEMBER`, `VIEWER` with explicit permission matrix.
- A member can belong to multiple workspaces; active workspace selection does not grant access by itself.

### Goal management
- Create/edit/archive goal; nest subgoals; attach milestones and tasks.
- Progress mode: task-based, milestone-based, numeric KPI, or manual (choose per goal).
- Prevent cycles, orphaned tenant references, and invalid progress values.
- Display list and tree view; bulk changes deferred until permission tested.

### Task management
- Status: `BACKLOG`, `TODO`, `IN_PROGRESS`, `IN_REVIEW`, `COMPLETED`, `CANCELLED`.
- Priority: `LOW`, `MEDIUM`, `HIGH`, `URGENT`.
- Task may have assignee, deadline, nested subtasks, comments.
- Completing a task records completion time and emits an activity event.

### Dashboard
- Cards: active goals, assigned tasks, completed tasks, overdue tasks, progress.
- Filter by organization, project, assignee and time range where authorized.
- Empty state guides new users to create first goal.

### AI planning
- User describes an objective; AI creates structured **draft** task plan.
- User edits/selects suggestions and confirms save.
- AI cannot invent membership, alter roles or execute unrelated tools.

## Next feature requirements
### Realtime chat
Org-only rooms, DM membership authorization, durable history, pagination, edit/delete rules, rate limits, file attachments via signed upload, presence optional.

### Ranking/challenges
Points from auditable events; anti-farming limits; leaderboards opt-in and visibility policies; never treat points as a financial entitlement.

### Knowledge
Document ACL, file metadata, safe ingestion, versioning, indexing, retrieval grounded in accessible documents only.

### Insights
A read-only page of counts for 7, 30 or 90 days against the period before. Sections follow the caller's other permissions: contacts and consent (what the caller may see in the CRM), forms (managers and above), and the caller's own meetings. Totals only; no names, answers or titles.

### CRM
Tenant-scoped contact ownership, consent-aware data collection, customer journey stages, deal stages, activity timeline, meeting scheduling and analytics.

## Definition of done for each feature
Role matrix + UI states + input validation + API contract + auditing as needed + tenant boundary tests + accessible interactions + docs.
