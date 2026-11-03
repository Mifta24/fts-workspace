# 08 — Roadmap

Keep the product simple (ADR-017). Details live in `10-DECISIONS.md` (why) and `13-PRODUCTION-READINESS.md` (what blocks launch). This file is only the status.

Last checked: 2026-11-03. CI passes on `main` (run 41599036120). The pilot is live at https://workspace.fts-tech.co.id.

| Phase | Status | Not built (and why) |
| --- | --- | --- |
| 0 Foundation | Done | — |
| 1 Productivity (projects, goals, tasks, dashboard, AI planner) | Done | Task dependencies, `role_grants` |
| 2 Collaboration (chat, notifications, points) | Done | Mentions, typing/presence, chat attachments, Redis for several gateways |
| 3 AI & Knowledge (files, search, assistant, 3 fixed automations) | Done | Semantic search, PDF/office text, rule builder, model-run actions (need an AI provider: OD-08) |
| 4 Business (CRM, scheduling, forms, booking with confirmation email and visitor cancel, insights) | Done | — |
| 5 SaaS & Production | **Not approved yet** | See below |

## Phase 5 — what is done

- Plans, limits, trials, operator console `/admin`, workspace suspend.
- Two-step sign-in (authenticator app); required for operators.
- Workspace deletion: owner asks, 14 days wait, then removal by operator button, `pnpm purge:workspace`, or an opt-in worker sweep. Tried on the server.
- Virus scan of uploads (ClamAV, running on the server in `optional` mode). Tested through the public site.
- Daily backup on the server; a restore from it was rehearsed with data and files.
- Signed-in load test (`pnpm test:load:http`), run against the public site: no failures.
- Public privacy and terms pages (draft), email alerts to one address, Turnstile on public forms.

## Phase 5 — what is still open

Needs a decision or someone else:
- Where to copy backups off the server (script is ready: `deploy/backup-offsite.sh`).
- Hosting region and a second host (OD-01), file storage (OD-04).
- AI provider and data location (OD-08).
- Prices and checkout (OD-05). A pilot does not need it.
- Lawyer review of privacy and terms; a data-processing agreement; data export.
- Independent security review.

Can be done in code:
- Password reset and invitation emails still need a real end-to-end check.
- A second alert recipient, an outside uptime monitor, error tracking.
- Content-Security-Policy `script-src`.

Phase 5 closes when the checklist in `13-PRODUCTION-READINESS.md` is signed off.

## Interface refresh (ADR-021)

Done: colours (light and dark), self-hosted font, progress thread, landing page, light sidebar, contrast fixes, translations check (en, id, ja).

Tests that use a fixed "now" of November 2026 (`booking`, `calendar-feed`, `calendar-sync`, `scheduling`, `task-deadline-reminders`, `billing`) pass today and may break once the real date passes it. The `automations`, `reminders` and `insights` tests were moved to far-future dates for that reason.
