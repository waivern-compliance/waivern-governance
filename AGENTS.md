<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md

Guidance for coding agents (and people) working in this repository. Most conventions are enforced by tools; this file covers what they can't check and points to the tools for the rest. The README explains what the product is and why it is built the way it is.

## Project

Waivern Governance Tool: a privacy and AI governance workflow platform. A single Next.js 16 app (App Router, Turbopack) with TypeScript, Auth.js (OIDC), Drizzle ORM on PostgreSQL with row-level security, and Tailwind CSS. It is multi-tenant: data belongs to an organisation, and access is scoped to legal entities within it.

```
src/
  app/          routes, pages and server actions (`actions.ts`)
  components/   UI
  services/     domain logic: one transaction per change, with its audit event
  lib/          shared helpers and domain rules (rbac, session, audit, statutory clocks, ...)
  db/           Drizzle client and schema
drizzle/        migrations, generated and hand-written
tests/          integration tests against a real Postgres
scripts/        seeding, migration, sweep and repo scripts
docs/           design notes, deployment guide and the generated help page
```

## Setup

```bash
pnpm bootstrap     # create .env.local from .env.example (secrets generated), install deps
pnpm db:up         # local PostgreSQL 16 on port 55432
pnpm db:migrate
pnpm seed          # demonstration organisation; sign in as anyone with ALLOW_DEV_SIGN_IN
pnpm dev
```

Run `pnpm bootstrap` first in every new clone or worktree. It is idempotent and never overwrites existing files. Machine-specific steps go in a gitignored `bootstrap.local.sh` in the main worktree, which `pnpm bootstrap` runs first with `REPO_ROOT` and `MAIN_ROOT` exported.

Team plans and designs live in GitHub issues. Personal scratch notes and screenshots go in `./.local` (gitignored).

## Checks

```bash
pnpm typecheck
pnpm lint          # pnpm lint:fix to fix
pnpm format        # pnpm format:fix to fix
pnpm test          # needs the local database (pnpm db:up); creates and migrates govern_test
pnpm build
```

CI runs all of these on every PR, plus a check that `docs/help.md` matches its source and a check that the Drizzle schema matches the migrations. The pre-commit hook formats and lints staged files. Never bypass a failing check (`--no-verify`, disabling a rule); find the cause.

When adding an environment variable, document it in `.env.example` with a comment saying what it is for and what happens when it is unset.

## Commits and pull requests

- Never commit to `main`. Branches are `<type>/<kebab-case-description>`, e.g. `feature/`, `fix/`, `docs/`, `refactor/`, `chore/` (`scripts/check-branch-name.sh`).
- Commit messages and PR titles follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) (`commitlint.config.mjs`). PRs are squash-merged, so the PR title becomes the commit on `main`.
- Messages are concise and factual: say what changed and why. No line counts, benefit lists or self-praise, and no phase, step or task numbers.
- Never mention client names or other sensitive information in branches, commits or PRs. This repository is public.
- Use `Closes #<issue>` in the PR body when it resolves an issue. The PR template lists what to include.

## Code conventions

**General**

- British English in code, comments and copy (`organisation`, not `organization`). Use hyphens, not em dashes, in copy (lint-enforced).
- Do what was asked, nothing more. Don't add backwards-compatibility shims; refactor instead, and remove anything left unused.
- Keep functions small and single-purpose. Prefer functional patterns.
- If an error points to a design flaw, propose refactoring options rather than a quick fix.
- Comments explain why, not what: the constraint, the law or the failure that made the code this shape. Match the density of the surrounding code.

**TypeScript**

- `type` over `interface`; union types (or `as const` arrays) over enums.
- No `any`; use `unknown` and narrow with type guards.
- Validate external input (the integration API, template definitions, imported config) with Zod and infer types from the schemas.
- Names: PascalCase `.tsx` files for components, kebab-case `.ts` files elsewhere. PascalCase types, camelCase functions starting with a verb, UPPER_CASE constants.
- Named exports, except where Next.js requires a default (pages, layouts, route segments).

**Data, tenancy and audit**

- Server actions (`src/app/**/actions.ts`) are thin: read the form, check the capability with `requireCapability(capability, { entityId })` from `@/lib/session`, call one service, then revalidate and redirect. A `"use server"` file may export only async functions (`tests/server-module-boundary.test.ts`).
- Services (`src/services/*.ts`) do the work inside `withOrganisation(organisationId, ...)` from `@/db/client`, which sets the tenant for row-level security. Use `scoped()` for a one-off read in an action.
- Never take `organisationId` from user input. Use `active.membership.organisationId`, and check every other id from input belongs to the organisation with the guards in `@/services/tenancy-guards`.
- Every change writes its audit event with `appendAuditEvent(tx, ...)` in the same transaction. Audit actions are namespaced past-tense verbs, e.g. `risk.created`.
- Capabilities in `@/lib/rbac` describe decisions, not screens. Personas change presentation only; nothing that authorises may read one (`tests/persona.test.ts`).
- Edit actions return failures through `refusable()` (`@/lib/edit-result`) and `EditForm`, so a refusal keeps what was typed. Write service error messages for the person reading them.

**Migrations**

- Change the schema in `src/db/schema`, then run `pnpm db:generate` and commit the SQL with its snapshot.
- Triggers, RLS policies and other guards are hand-written: create the file with `pnpm db:generate --custom --name=<what-it-guards>` so it is registered in `drizzle/meta/_journal.json`. `/api/health` compares the journal with the database, so an unregistered SQL file is never applied and a missing one fails health.

**Tests and help**

- Tests use `node:test` and `node:assert/strict` against the real database. Each file builds its own organisation with a unique slug, so tests don't need cleanup. Name tests as behaviour: `it("refuses values off the scale")`.
- Add or change a screen, and you change its help: topics live in `src/lib/help/topics.ts`. Run `pnpm help:md` and commit `docs/help.md`, which is generated; never edit it by hand.
