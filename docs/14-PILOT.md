# 14 — Pilot Onboarding and Feedback Prioritization

A pilot is a small number of real organizations using the product for a fixed period so that decisions about pricing, scope and launch rest on evidence. Nothing here is a commitment to customers; numbers are starting points to adjust.

## Choosing pilot organizations
- Three to five organizations of 3–25 people who have the problem the product solves (goals and tasks for a team, plus at least one of CRM, forms or scheduling), and who will talk to us weekly.
- At least one that works in Japanese or Indonesian, because those locales are shipped but have had no real users.
- Agree in writing before starting: what data they may put in (no special-category personal data, no card data), that the service is a pilot with no uptime or recovery promise (see `12-OPERATIONS.md`, backup section), how long it runs (suggested: six weeks), and what happens to their data at the end (export or deletion, their choice).

## Before day one (operator checklist)
1. Create the workspace for them or let the owner create it. Set `BILLING_ENABLED=true` only if the pilot should run on a trial plan; otherwise leave workspaces unmetered.
2. In `/admin`, set the plan for the pilot (suggested: TEAM, active, not a trial, so nothing changes under them mid-pilot).
3. Confirm email delivery works for invitations and password reset in the pilot environment (it does not in development: links are printed to the log).
4. If their public forms or booking pages will be used, enable Turnstile and review the pages' privacy wording with them.
5. Give the owner the contact for incidents and tell them how to report problems (below).

## First week
- Day 1: a 30-minute call. The owner creates their goals and invites the team (members page); we watch where they hesitate and do not explain unless asked.
- Day 3: check the console and the workspace audit trail for errors or unused invitations; ask what they could not find.
- Day 7: first review call using the questions below.

## Collecting feedback
- One shared list, one row per piece of feedback: date, organization, who said it, the words they used (verbatim), what they were trying to do, how often it happens, workaround, and a link to evidence (a screen, a log line with its correlation id).
- Channels: the weekly call, a dedicated email address, and the owners' direct messages. There is **no in-app feedback form yet**; add one only if these channels prove too slow.
- Record the problem, not the requested solution. "I can't tell which tasks are late" is feedback; "add a red badge" is a possible answer to it.

## Prioritizing
Score each *problem* (not each request) on a 1–5 scale and sort by the result; ties go to the cheaper item.

| Factor | Question |
| --- | --- |
| Reach | How many pilot organizations hit it? |
| Pain | Does it stop the job, slow it, or only annoy? |
| Evidence | Seen in use, or only said? |
| Risk | Does it involve data loss, privacy, tenant isolation or money? Those jump the queue regardless of score. |
| Cost | Rough size: hours, days, weeks. |

Rules: security, privacy and data-loss problems are fixed first and are not weighed against features. Anything that touches a permission or tenant boundary needs the tests in `AGENTS.md`. A request from one organization that nobody else shares waits for a second signal.

## Questions for the weekly call
1. What did you do in the product this week that you were glad to do? What did you avoid?
2. Where did you get stuck or ask someone for help?
3. What did you do outside the product that you expected the product to do?
4. Did anything surprise you about who could see what?
5. Would you notice if we switched it off? Who would complain first?

## Metrics from the PRD, read during the pilot
Activation (workspace created + first goal + first task), weekly active members, weekly completed tasks, overdue-task trend, AI draft acceptance rate, AI cost per active organization (the console shows AI tokens per workspace per month), queue failure rate and error rate. Report them as counts per organization, never as a ranking of people.

## Exit
At the end: a written summary per organization (what worked, what did not, what they would pay for, what they would not use), the prioritized list, a decision on each open item in `10-DECISIONS.md` that the pilot informed (especially OD-05 pricing and OD-08 AI provider), and data export or deletion as agreed. The launch decision uses `13-PRODUCTION-READINESS.md`.
