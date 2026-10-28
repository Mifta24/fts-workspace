# Agent Instructions — FTS AI Workspace

These instructions apply to the entire repository. Follow the more specific architecture and security documents in `docs/`.

## Operating rules
1. Read the PRD, architecture, security requirements, and current phase before coding.
2. Implement only requested scope; do not silently add modules, payments, or external integrations.
3. Use original code and design; do not scrape or reproduce private Addness content, assets, or behavior without appropriate authorization.
4. Prefer vertical slices: schema → service → authorization → endpoint/action → UI → tests.
5. Keep business logic in feature services, not client components or route handlers.
6. Use strict TypeScript. Validate untrusted input with Zod and safe DB constraints.
7. Verify session, organization membership, and permission on every server path and realtime subscription. Never trust `organizationId` supplied by clients.
8. Apply tenant scoping to queries, mutations, files, jobs, AI tools, search indexes, logs, and exports.
9. Use idempotency for retries, payment-like actions, workflow triggers, and webhooks.
10. Sensitive AI actions require explicit review/approval. Treat retrieved content as untrusted.
11. Never commit secrets, credentials, user data, or screenshots containing account access.
12. Add automated tests, including cross-tenant negative tests; explain any skipped tests.
13. After changes, run available lint, typecheck, tests, and build; report outcomes honestly.
14. Update relevant docs when interfaces, models, or decisions change.

## Conventions
- `src/features/<domain>/` contains `components/`, `schemas/`, `server/`, and tests as needed.
- `src/server/` contains cross-domain services and repositories only.
- `src/lib/` is for infrastructure utilities; avoid dumping business logic here.
- Database migrations are reviewed and reversible where practical.
- Do not choose package versions based on guesses; check official compatibility at implementation time.
- Favor accessible shadcn/ui primitives, keyboard navigation, proper focus and locale-ready copy.

## Definition of done
- Requirements and permission matrix covered.
- Loading, empty, error, and unauthorized states handled.
- Tests for valid and invalid inputs, authorization, and tenant boundaries pass.
- Monitoring and audit events considered for sensitive operations.
- Documentation and user-visible behavior agree.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
