# 05 — UI/UX & Design System

## Design goals
Professional, calm, responsive, efficient for power users; original identity rather than pixel-identical reproduction of the reference platform.

## Visual direction (ADR-021)
The product is about turning a large goal into small steps, so the interface shows **progress** and stays quiet everywhere else.
- **One signature element: the progress thread** (`src/components/ui/progress-thread.tsx`). A slim bar in four equal segments that fills once when the page loads. Use it for progress toward something (goals, challenges, the dashboard progress card). Do not use it for plain counts or for usage against a limit (billing keeps its own meter).
- **Quiet surfaces.** Cards have a hairline border and no shadow; separation comes from spacing and thin lines, not from stacked boxes. Do not add decoration that carries no information.
- **Colour has jobs.** The primary green marks actions, the current location and progress. Amber (`--warning`) is only for "due soon". Red (`--destructive`) is only for errors and destructive actions.
- **Type.** One family. Text is left-aligned, in sentence case, with lines of at most about 65 characters. No all-caps labels and no decorative labels above headings. Numbers use tabular figures so percentages and dates line up.
- **Motion.** Only the progress thread fill runs without a user action. Everything stops under `prefers-reduced-motion`.
- **Copy.** Plain verbs that say what happens ("Sign in", "Create an account"). An action keeps the same name from button to confirmation.

## Navigation proposal
- Sidebar: Overview, Goals, My Tasks, Projects, Chat, Members, Challenges, Rankings, Explore, Settings.
- Explore hub groups Knowledge, Files, AI, CRM, Scheduling, Analytics, Workflows and future modules.
- **Simple and full views (as built).** The workspace sidebar starts in a *simple* view for everyone: Overview, Goals, Tasks, Projects, Chat, Schedule, Inbox and Members. A button at the bottom of the sidebar ("Show all features") adds the specialist pages (Progress, Files, Knowledge, Assistant, CRM, Forms, Insights, Plan) and flips to "Show essentials only". The choice is a per-browser preference kept in the `fts_nav_mode` cookie (no database change; anything but `full` means simple), read on the server so the first paint is right. It is **only a view preference**: permissions still decide which entries exist (a viewer never gets Plan, in either view), every page still authorizes on the server, a page that is not listed still opens from a link, and the page you are on always stays in the menu. Not synced across devices.
- **Sidebar look (as built).** A light surface (`--sidebar`) with a right border (a bottom border on narrow screens). The current page is a card in the primary colour; the unread badge uses the primary token.
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
| `--sidebar` | `#EAEEE9` | `#111A16` |

Typeface: Plus Jakarta Sans (self-hosted through `next/font`), with system Japanese fonts as fallback. Numbers use tabular figures.

Use semantic tokens for light/dark themes; do not hard-code colours in components.

### Contrast (computed 2026-11-02)
WCAG contrast ratios calculated from the hex values above with a script. This is not a formal accessibility audit.

| Pair | Light | Dark |
| --- | --- | --- |
| Text on background | 15.4 | 15.2 |
| Muted text on background | 6.8 | 7.9 |
| Muted text on the sidebar | 6.2 | 7.6 |
| Button text on primary | 6.4 | 7.6 |
| Primary on background | 6.0 | 7.5 |
| Warning, destructive and success text on background | 4.9, 6.1, 5.3 | 10.1, 6.6, 9.1 |
| Progress fill on its track | 5.6 | 6.2 |
| Input border on a card | 3.8 | 3.7 |

Form field borders (`--input`, `#78877F` light and `#66796F` dark) reach the 3:1 that WCAG 1.4.11 asks for on component boundaries, also on the muted surface (3.3 in both themes). Fields keep a visible focus ring.

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

## Visual refresh status
- **Done:** colour tokens (light and dark), Plus Jakarta Sans, the progress thread on goals, challenges and the dashboard, the landing page with an example goal (en, id, ja), the light sidebar (the current page also has a thin ring so it stays visible in dark mode), cards without shadows, input border contrast, a bottom line under the workspace top bar (the organization name appears there only on narrow screens, where the sidebar hides it), and a wordmark above the sign-in, sign-up and password pages.
- **Checked in a browser (2026-11-02):** the landing page, sign-in, the workspaces list, the dashboard and the goals page in light and dark at 1280 px, and the dashboard at 390 px, using the seeded end-to-end database.
- **Not viewed yet:** the dashboard progress card with a value (it needs a task-based goal with tasks), and the tasks, progress, chat, CRM, forms, schedule, billing and admin pages.
- **Not done:** a Japanese-font choice (system fonts are used for Japanese).
