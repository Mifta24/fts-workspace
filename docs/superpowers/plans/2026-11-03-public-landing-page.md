# Public Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Present FTS AI Workspace through a complete, responsive, localized public landing page.

**Architecture:** Keep the existing localized server route and authentication redirect. Build the landing sections as server-rendered UI using the app's semantic design tokens and existing navigation, with original sample data and localized copy.

**Tech Stack:** Next.js 16 App Router, React Server Components, TypeScript, Tailwind CSS, next-intl.

**Spec:** `docs/superpowers/specs/2026-11-03-public-landing-page-design.md`

## Global Constraints

- Preserve the existing authenticated redirect to `/workspaces` and `/sign-in` and `/sign-up` routes.
- Keep English, Indonesian, and Japanese message dictionaries in key parity.
- Use only implemented FTS Workspace capabilities and clearly mark illustrative data.
- Do not copy Addness wording, assets, source, or exact page composition.
- Do not introduce new dependencies, external integrations, pricing, trial, or payment claims.
- Follow `AGENTS.md`, `docs/05-UI-UX.md`, and the installed Next.js 16.4.3 guides.

## Review Focus

- Very long Japanese and Indonesian labels must wrap without horizontal overflow; cover with locale rendering at phone width.
- The hero sample must be identified as illustrative and must not use tenant data; cover with a rendered DOM assertion.
- A signed-in visitor must still reach the workspace list; preserve and check the redirect path.
- All CTAs must use existing localized routes or in-page anchors; inspect links in the rendered page.
- Keyboard focus must remain visible and FAQ controls must remain usable without a pointer; inspect keyboard flow in browser.

---

### Task 1: Implement the localized public landing page

**Files:**
- Modify: `src/app/[locale]/page.tsx`
- Modify: `messages/en.json`
- Modify: `messages/id.json`
- Modify: `messages/ja.json`
- Modify: `docs/05-UI-UX.md`
- Modify: `docs/08-ROADMAP.md`
- Create: `e2e/landing.spec.ts`
- Test: `src/i18n/messages.test.ts` and `e2e/landing.spec.ts`

**Interfaces:**
- Consumes: `getLocale`, `getTranslations`, `getSessionUser`, localized `Link` and `redirect`, semantic UI tokens, `ProgressThread`.
- Produces: complete server-rendered landing page with page anchors, existing sign-in/create-account links, illustrative workspace demo, product overview sections, and translated copy in all supported locales.

- [ ] Read the installed Next.js App Router page and server-component guides and inspect the current page, locale messages, design tokens, and navigation conventions.
- [ ] Replace the compact home content with the approved section sequence and add matching message keys in all three locale files.
- [ ] Update the UI/UX and roadmap notes to reflect the complete public product introduction and remaining visual review status.
- [ ] Run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, and `pnpm build`; review failures and fix those caused by this change.
- [ ] Start the app and inspect the actual rendered landing page at desktop and phone widths in English, Indonesian, and Japanese; check links, focus, and overflow.
- [ ] Review the final diff, commit the scoped changes, and push the current branch to its configured upstream.
