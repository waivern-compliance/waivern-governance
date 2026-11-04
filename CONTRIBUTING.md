# Contributing

Thanks for your interest in the Waivern Governance Tool. Bug reports, fixes and improvements are all welcome.

## Before you start

- **Bugs:** open an issue with steps to reproduce. For anything security-related, follow [SECURITY.md](SECURITY.md) instead.
- **Changes beyond a small fix:** open an issue first to discuss the approach. The README sets out what this tool deliberately is and is not, and some reasonable-sounding features are out of scope on purpose.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development

You need Node 24 (see `.nvmrc`), pnpm 10 and Docker.

```bash
pnpm bootstrap     # creates .env.local and installs dependencies
pnpm db:up
pnpm db:migrate
pnpm seed
pnpm dev
```

[AGENTS.md](AGENTS.md) describes the project layout, the checks, and the code conventions: how tenancy, permissions and the audit trail work, how to write migrations, and how to keep the help pages current. It applies to people as well as coding agents.

## Pull requests

- Branch names are `<type>/<kebab-case-description>`, e.g. `fix/login-redirect`.
- PR titles follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/), e.g. `fix: keep the entity filter after saving a risk`. PRs are squash-merged, so the title becomes the commit on `main`.
- Run `pnpm typecheck`, `pnpm lint`, `pnpm format` and `pnpm test` before you push. CI runs them too, and every check must pass before a PR can merge.
- Add or update tests for the behaviour you change.

## Licence

This project is licensed under the [GNU Affero General Public License v3.0 only](LICENSE) (`AGPL-3.0-only`). By contributing, you agree that your contributions are licensed under the same terms.
