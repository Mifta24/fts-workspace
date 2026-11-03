# Public Landing Page Design

## Goal

Turn the public home route into a complete, responsive product introduction for FTS AI Workspace so prospective users can understand the product and create an account.

## Context

The current home route is a short introduction with an illustrative goal-progress sample and sign-in/sign-up links. ADR-021 previously chose that concise direction. The user has now asked for a full-length page inspired by the public structure of `https://hp.addness.com` and selected the full-page scope. This design uses only broad public presentation patterns; all copy, visual composition, and code remain original to FTS AI Workspace.

## Approaches

1. **Complete product landing page (selected):** use a clear header and a sequence of product story, capability, workflow, privacy, use-case, getting-started, and FAQ sections. This best supports presenting the product to prospective users.
2. **Hero-only refresh:** strengthen the headline and demo while keeping the rest of the page short. This is quicker, but does not match the requested full-page presentation.

## Design

- Keep the localized route and render in English, Indonesian, and Japanese using the existing message dictionaries.
- Use the existing light/dark semantic tokens, Plus Jakarta Sans, and calm FTS visual identity. Build the main visual from original HTML/CSS product panels and illustrative data; do not copy Addness text, assets, source, or exact composition.
- Add an accessible header with the FTS wordmark, links to page sections, language control if already supported by existing routing conventions, and sign-in/create-account actions.
- Lead with an original value proposition and a prominent illustrative workspace panel showing a goal, progress, and next tasks. Clearly label sample content as illustrative.
- Explain the flow from goal to tasks to team progress, then introduce capabilities already implemented: goals and tasks, team collaboration, knowledge and AI assistance, CRM and scheduling, and workspace privacy controls.
- Include representative individual/team use cases, a short getting-started sequence, and a concise FAQ. Keep claims bounded by current behavior: AI outputs are reviewed by people; access is tenant- and permission-scoped; do not advertise unconfigured AI providers, checkout, trial pricing, or unsupported integrations.
- Keep existing sign-in/sign-up destinations and authenticated-user redirect behavior. Keep the shared legal footer.
- Ensure responsive layout, keyboard-visible focus, semantic headings, descriptive labels, and reduced-motion support. Any motion must respect the existing UI guidance.

## Scope

Modify the public home page and its locale messages; update UI/UX and roadmap notes to reflect the new landing-page direction and browser review. No database, authentication, billing, external integration, or product capability changes.

## Acceptance

- The three locales show the full page with complete, equivalent section coverage and matching message keys.
- Signed-in users still redirect to workspaces; sign-in and account-creation links work.
- The layout remains usable at desktop and phone widths without horizontal overflow, and keyboard focus is visible.
- Browser review confirms the rendered page matches the new design; static checks and the existing localization checks pass.
