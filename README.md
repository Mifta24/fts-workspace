# FTS AI Workspace

> Technical documentation baseline · v1.0 · 2026-10-28

FTS AI Workspace is a proposed multi-tenant, AI-assisted productivity and business management SaaS. Its feature inventory is informed by screenshots of Addness, but implementation, content, UI, and code must be original. Observed UI is **not** proof of internal logic or a license to reproduce proprietary assets.

## Vision
Users organize goals and tasks, collaborate in workspaces, manage knowledge and customers, and use permission-aware AI assistants to prepare work.

## Stack (target, verify compatibility before installing)
- Next.js App Router, React, TypeScript (strict)
- Tailwind CSS, shadcn/ui, accessible Radix primitives
- PostgreSQL, Prisma
- Better Auth with organization support (verify actual plugin APIs)
- Redis + BullMQ workers; a dedicated real-time gateway for chat
- Vercel AI SDK with OpenRouter and optional LM Studio adapter
- S3-compatible private object storage
- Vitest, Playwright, CI, Docker

## Start here
1. Read `AGENTS.md` and `docs/01-PRD.md`.
2. Decide outstanding questions in `docs/10-DECISIONS.md`.
3. Implement Phase 0 in `docs/08-ROADMAP.md`.
4. Make a feature vertical slice: UI → validation → authorization → service → database → tests.
5. Review security controls in `docs/07-SECURITY.md` before deployment.

## Document map
| Document | Purpose |
| --- | --- |
| `AGENTS.md` | Instructions for coding agents |
| `docs/01-PRD.md` | Product scope, personas, requirements |
| `docs/02-ARCHITECTURE.md` | Runtime components and boundaries |
| `docs/03-DATABASE.md` | Proposed tables, relations and constraints |
| `docs/04-FEATURES.md` | Module-level requirements |
| `docs/05-UI-UX.md` | Design system, UX flows, accessibility |
| `docs/06-API.md` | API and server action contracts |
| `docs/07-SECURITY.md` | Security and tenant isolation |
| `docs/08-ROADMAP.md` | Phases and release gates |
| `docs/09-AI-INTEGRATION.md` | Agent tools, retrieval and governance |
| `docs/10-DECISIONS.md` | ADRs and open questions |

## Status
**Phase 0 (foundation) implemented.** Email/password auth with verification and reset, organizations with role-based membership, a tenant authorization service, i18n (`en`, `ja`, `id`), health check, CI. Goals, tasks, dashboard and AI arrive in Phase 1. No production readiness is claimed.

## Local development
Requirements: Node.js 24+, pnpm 11, and either Docker or nothing else (an embedded PostgreSQL is available).

```bash
pnpm install
cp .env.example .env            # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
docker compose up -d postgres   # or, without Docker: pnpm db:local (keep it running)
pnpm db:deploy                  # apply migrations
pnpm db:seed                    # optional: demo tenants acme/globex (see prisma/seed.ts)
pnpm dev
```

Open http://localhost:3000. Sign-up sends a verification email; in development the link is printed in the server log (`[dev email]`). If port 3000 is taken, run `pnpm dev --port 3001` and set `BETTER_AUTH_URL` to match.

| Command | Purpose |
| --- | --- |
| `pnpm lint` / `pnpm format:check` / `pnpm typecheck` | Static checks |
| `pnpm test` | Unit + integration tests (uses `TEST_DATABASE_URL`, or starts an embedded PostgreSQL) |
| `pnpm test:e2e` | Playwright end-to-end tests (starts its own app, gateway and database) |
| `pnpm worker` | Background worker (document indexing); needs the same `STORAGE_DIR` as the app |
| `pnpm gateway` | Realtime gateway (Socket.IO) on port 4000; see `docs/02-ARCHITECTURE.md` |
| `pnpm test:load` | Gateway load test (default 500 sockets; `CLIENTS`, `EVENTS`, `RATE` override) |
| `pnpm build` | Production build |
| `pnpm check` | All of the above |
| `pnpm db:migrate` / `pnpm db:deploy` | Create / apply migrations |
| `pnpm db:seed` / `pnpm db:studio` | Seed (non-production) / browse data |

## Code layout (Phase 0)
```
src/
  app/[locale]/            # localized routes: home, auth pages, workspaces, w/[organizationSlug]
  app/api/auth/[...all]/   # Better Auth handler
  app/api/health/          # health check
  features/auth/           # auth forms (client)
  features/organizations/  # schema, service + getAuthorizedOrganization, server action, UI, tests
  server/services/         # cross-domain services (audit)
  lib/                     # auth, db, env, logger, email, errors, permissions
  i18n/                    # next-intl routing and request config
messages/                  # en, ja, id dictionaries
prisma/                    # schema, migrations, seed
tests/                     # integration tests (auth, tenant isolation) and test DB bootstrap
scripts/                   # local embedded PostgreSQL
```
