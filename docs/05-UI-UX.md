# 05 — UI/UX & Design System

## Design goals
Professional, calm, responsive, efficient for power users; original identity rather than pixel-identical reproduction of the reference platform.

## Navigation proposal
- Sidebar: Overview, Goals, My Tasks, Projects, Chat, Members, Challenges, Rankings, Explore, Settings.
- Explore hub groups Knowledge, Files, AI, CRM, Scheduling, Analytics, Workflows and future modules.
- **Simple and full views (as built).** The workspace sidebar starts in a *simple* view for everyone: Overview, Goals, Tasks, Projects, Chat, Schedule, Inbox and Members. A button at the bottom of the sidebar ("Show all features") adds the specialist pages (Progress, Files, Knowledge, Assistant, CRM, Forms, Insights, Plan) and flips to "Show essentials only". The choice is a per-browser preference kept in the `fts_nav_mode` cookie (no database change; anything but `full` means simple), read on the server so the first paint is right. It is **only a view preference**: permissions still decide which entries exist (a viewer never gets Plan, in either view), every page still authorizes on the server, a page that is not listed still opens from a link, and the page you are on always stays in the menu. Not synced across devices.
- Topbar: organization switcher, global search, notifications, create action, profile menu.
- Breadcrumbs on nested pages; persistent accessible primary navigation.

## Visual tokens (as built)
Calm, light and focused on progress. The one signature element is the progress thread (`ProgressThread`): a slim four-segment bar used for goals, challenges and the dashboard. Everything else stays quiet.

| Token | Light | Dark |
| --- | --- | --- |
| `--background` | `#F6F7F5` | `#0E1512` |
| `--foreground` | `#16211D` | `#E4EAE6` |
| `--primary` | `#0F6B5C` | `#3DB8A0` |
| `--border` | `#DDE3DE` | `#25322C` |
| `--warning` | `#9A5F08` | `#FDB022` |
| `--sidebar` | `#14201C` | `#14201C` |

Typeface: Plus Jakarta Sans (self-hosted through `next/font`), with system Japanese fonts as fallback. Numbers use tabular figures.

Use semantic tokens for light/dark themes. Verify contrast ratios; colors above are a starting proposal, not finished accessibility certification.

## Core screens
1. Onboarding: create/select organization, invite or skip, first goal.
2. Dashboard: KPI cards, active goals, overdue tasks, AI quick prompt.
3. Goals: tree/list view, details panel, progress, linked tasks.
4. Tasks: list/board filters, create/edit modal, detail page.
5. Members: invite, role list, access audit.
6. Chat (later): channel list, messages, participants.
7. Explore: categorized module launcher with plan/permission indicators.
8. Settings: profile, organization, notification, security.

## Interaction patterns
- Use server-side paginated data for large lists.
- Provide skeleton, empty, error, conflict and unauthorized states.
- Show explicit confirmation for destructive operations.
- Use optimistic updates only with a reliable rollback path.
- Full keyboard operation; visible focus; avoid hover-only actions.
- Accessibility: semantic elements, form labels, screen-reader status, logical tab order.

## Localization
- Internationalize from day one with `en`, `ja`, and `id` dictionaries.
- Do not concatenate translated sentence fragments.
- Support Japanese text length and line breaks; use Intl APIs for dates/currency.
- Store timestamps in UTC; display user-selected timezone.

## Prototype acceptance
A new user can create an organization, create a goal, add tasks, invite a member and review an AI task plan without guidance.
