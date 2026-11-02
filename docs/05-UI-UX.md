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

Typeface: Plus Jakarta Sans, a variable font file kept in `src/app/fonts/` (Latin subset, SIL OFL; see the README there) and loaded with `next/font/local`, so builds and the dev server do not need to reach Google. Japanese and any character outside the Latin subset use the system fonts as fallback. Numbers use tabular figures.

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
- **Checked in a browser (2026-11-02), against the seeded end-to-end database:** the landing page, sign-in, the workspaces list, and, in light and dark at 1280 px, the dashboard (including the task progress card at 50%), projects, goals and a goal page, tasks and a task page, progress, chat, CRM with a contact and the pipeline, forms with a form page and the public form, schedule, booking pages and the public booking page, insights, members, billing, knowledge, automations and the operator console; the dashboard at 390 px. The inbox, files, assistant and AI plan pages were also reviewed in both themes (the assistant and plan pages show their "not configured" state, because no model provider is set up here). With these, every signed-in page type has been viewed at least once; pages with real content in them (for example a chat with messages or a populated task list) were viewed only with the small data set above.
- **Found and fixed while checking:** (1) the Automations page showed a raw message key for one rule, because a literal `<form name>` was read as a rich-text tag. Literal angle brackets in messages must be quoted with apostrophes (`'<form name>'`); `src/i18n/messages.test.ts` now fails on any message that does not parse and on keys that differ between languages. (2) The font was fetched from Google when the app compiled; when that request failed, the dev server logged errors and pages were very slow, so the font is now a local file. (3) On the Schedule page the "Booking pages" link sat directly above the next label because an inline link ignores the vertical spacing of its siblings; it is now `inline-flex`. Any link that is a conditional direct child of the page needs the same.
- **Checked in other languages and on a phone (2026-11-02):** the landing page, sign-in, dashboard, goals, tasks, schedule, CRM and billing in Japanese and Indonesian at 1280 px, and 14 workspace pages (overview, goals, tasks, schedule, CRM, billing, members, chat, progress, forms, insights, automations, projects, knowledge) at 390 px. A script measured horizontal overflow on them and on the Japanese and Indonesian versions of the first six: none. Only a few pages were also looked at by eye in Japanese, Indonesian and at 390 px (landing, dashboard, goals, schedule, CRM); the rest were measured, not viewed.
- **Found and fixed:** Japanese text broke in the middle of words ("仕/事") because Japanese has no spaces. `globals.css` now sets `line-break: strict` and `word-break: auto-phrase` for `:lang(ja)`; browsers without `auto-phrase` keep the old behaviour.
- **Keyboard and page structure (2026-11-02), with a probe written for this check (no outside code; a request to run axe-core from a CDN was refused, so no automated axe scan was run):** walking with Tab through the landing page, sign-in, overview, goals, tasks and schedule in light and dark showed a visible focus indicator on every element of the app. Across 17 workspace pages, no button or link without a name, no field without a label, no image without `alt`, no duplicate ids and no skipped heading levels. It found that most pages had two or three `h1` elements, because `CardTitle` always rendered an `h1`. `CardTitle` now takes `level` (default 1, for a card that is the page's only title such as sign-in and invitations); the 22 cards inside pages that already have a title use `level={2}`. Every page checked now has exactly one `h1`.
- **Not done:** a Japanese-font choice (system fonts are used for Japanese), Latin Extended and Vietnamese glyphs (not in the shipped subset), an automated axe or screen-reader pass, and a manual screen-reader test. Focus was checked only on the six pages listed; modals, if any are added later, need their own check.
