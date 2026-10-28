# 01 — Product Requirements Document

## Product statement
FTS AI Workspace is a multilingual, multi-tenant productivity and business SaaS offering goals, tasks, team collaboration, knowledge, CRM, analytics, and AI assistance from one workspace. The product is independent and inspired by publicly observable product patterns, not a functional clone of proprietary implementation.

## Primary users
- **Individual:** tracks personal goals and actionable tasks.
- **Team member:** collaborates on assigned tasks, chats, and reviews knowledge.
- **Team manager:** manages milestones, workload, completion and reporting.
- **Organization owner/admin:** controls members, permissions, usage and billing.
- **Sales operator (later):** handles leads, appointments and pipelines.

## Jobs to be done
1. Turn a high-level goal into trackable milestones and tasks.
2. Coordinate who owns what, by when, and with what progress.
3. Use AI to propose, summarize, and retrieve work while retaining user control.
4. Keep workspace information isolated across organizations.
5. Track engagement and measurable outcomes without requiring public leaderboards.

## MVP scope (Phase 1)
- Email sign-in/sign-up, recovery, secure sessions.
- Organizations, invitations, active workspace switch, role-based access.
- Projects, nested goals, milestones, tasks, assignments, priority, due dates, status and comments.
- Dashboard: user tasks, progress, activity and actionable next steps.
- AI planning: draft decomposition of a goal into proposed tasks; human review and save.
- English UI baseline with Japanese and Indonesian localization architecture.

## Later releases
- Phase 2: chat, notifications, challenges, rankings.
- Phase 3: knowledge, files, AI tool execution, workflows, controlled MCP integration.
- Phase 4: CRM, customer journey, scheduling, forms, analytics.
- Phase 5: subscription billing, limits, enterprise controls, operational hardening.
- Optional backlog: virtual space, recording and transcription, desktop/mobile applications.

## Non-goals for MVP
- Automated outbound communication, unrestricted agents, public network, custom database builder, video meeting recording, and payment processing.
- Identical UI/copy/assets or extraction of private account data from the reference product.

## Representative user stories
- As an owner, I can create an organization and invite a member with a chosen role.
- As a member, I can create a goal with subgoals and link tasks.
- As a manager, I can assign a task and see progress by project.
- As a user, I can request an AI task plan and accept or reject each suggestion.
- As a member of two organizations, I cannot access organization A data while using organization B.

## MVP acceptance criteria
1. Users can authenticate and select one of their authorized organizations.
2. CRUD actions for projects, goals, and tasks obey permission and tenant rules.
3. Nested goals do not permit cycles or cross-tenant parents.
4. Task progress and dashboard counts are consistent with stored state.
5. AI plans are proposals; no mutation occurs without confirmation.
6. Cross-tenant access attempts fail on routes, actions, and direct object identifiers.
7. Key E2E workflows and backup restoration have been tested before pilot.

## Success metrics (proposed, not commitments)
- Activation: organization created + first goal + first task.
- Weekly active members and weekly completed tasks.
- Goal completion and overdue-task trends.
- AI draft acceptance rate and AI cost per active organization.
- Reliability: error rate, queue failure rate, backup restore outcomes.

## Open product questions
- Should guest/individual accounts be personal workspaces or organizations of one?
- Which workspaces share leaderboard visibility?
- Exact goal progress calculation: task completion, weighted milestones, or custom KPIs?
- Trial, paid plans, and AI quotas by tenant?
