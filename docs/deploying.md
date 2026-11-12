# Deploying

## What any host needs

Nothing in the application is tied to a particular host. It is a Node process
and a Postgres database, configured entirely through environment variables, so
it runs on a managed platform, a container service, or a virtual machine you
administer yourself.

| Requirement | Detail |
| --- | --- |
| Node 24 | Runs `pnpm build` then `pnpm start`. Nothing needs compiling at install time. |
| PostgreSQL 13 or newer | 16 in development. No extensions — `gen_random_uuid()` is built in from 13. |
| Environment variables | `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL` (or `APP_URL` and `APP_ALIAS_URLS` for more than one address), `INTEGRATION_KEY`, `CRON_SECRET`, and the credentials for at least one OIDC provider. |
| A scheduler | Hourly. Either runs `pnpm sweep:prod` as a job, or makes an authenticated request to `/api/cron/sweep`. |
| TLS termination | Wherever it normally lives for you. The application assumes it is behind it. |

That is the whole list. There is no queue, no object store, no cache tier and no
platform SDK, which is why the deployment story stays short.

Files attached to records — signed agreements, due diligence, forensic reports —
are held in Postgres rather than in object storage, which is what keeps that
list at five. It also means a document and the audit trail about it travel in
one backup rather than two systems that can drift apart. Uploads are capped at
10MB each and the accepted types are an allowlist; an organisation storing
thousands of large documents should move to object storage, which is a change
of adapter rather than of model.

**Migrations.** `pnpm db:migrate:deploy` applies them using the application's own
runtime dependencies, so it works in a pruned production image. Run it wherever
your platform lets you act before new code takes traffic — a release phase, a
pre-deploy hook, an init container, or prefixed to the start command
(`pnpm db:migrate:deploy && pnpm start`). If it fails, the deploy should fail
with it: code expecting a column the database lacks is worse than the previous
version continuing to serve.

Prefixing the start command runs migrations once per replica. That is fine at one
replica and wrong above it — with several, use a release phase or a one-off job
so a single process migrates and the rest simply start.

**Scheduled work.** Two ways in, because platforms differ. A job runner executes
`pnpm sweep:prod` directly against the database. A scheduler that can only make
an HTTP request calls `/api/cron/sweep` with `Authorization: Bearer $CRON_SECRET`
— and a deployment with no secret set refuses every such call rather than
defaulting open. Nothing time-based happens until one of the two exists: no
recurring reviews, no service-level breaches recorded, no outbound webhooks
delivered.

**Health checking.** Point the platform's check at `/api/health`, not at the
port. A Next.js process binds its port and reports ready before it has spoken to
the database once, so "the container is up" and "the application works" are
different claims. `/api/health` answers the second: it reports whether the
database responds and whether its schema matches the migrations this build was
compiled against, and returns 503 when it does not. A forgotten migration
otherwise produces a deployment that sits green while every page fails.

**Data residency is your choice, not ours.** The application pins no region and
holds no opinion about where it runs. Where the database lives is a deployment
decision, and it is worth making deliberately: if a requirement is that personal
data stays in a particular jurisdiction, choose a provider with a region there
rather than one that is merely adequate. A default region in another jurisdiction
is the kind of detail that fails a procurement review.

**One thing that catches people out.** There is no password login. An OIDC
provider has to be configured and somebody has to be granted access before
anyone can get in — `pnpm grant <email>` does the first one, after which
People and access under Settings does the rest.

## Examples

These show the requirements above on particular hosts. Neither is
recommended over any other platform.

- [Railway](deploying-railway.md): the application, a Postgres instance and a
  scheduled job for the sweep, step by step.
- Vercel: `vercel.json` in the repository pins a region and schedules the sweep
  through `/api/cron/sweep`.
