#!/usr/bin/env bash
# bootstrap.sh - prepare a clone or worktree for development. Idempotent; safe to re-run.
#
# Usage:
#   pnpm bootstrap               run the personal hook, create a missing .env.local, install deps
#   pnpm bootstrap --no-install  skip `pnpm install`
#
# Personal hook: if `bootstrap.local.sh` (gitignored) exists in this tree or in
# the main worktree, it runs first, with REPO_ROOT and MAIN_ROOT exported. Put
# machine-specific steps there, such as copying .env.local from the main
# worktree or pointing `.local` at a store outside the repo.
set -euo pipefail

RUN_INSTALL=1
for arg in "$@"; do
  case "$arg" in
    --no-install) RUN_INSTALL=0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
COMMON_DIR="$(cd "$(git rev-parse --git-common-dir)" && pwd)"
MAIN_ROOT="$(dirname "$COMMON_DIR")"   # parent of the shared .git dir = main worktree
export REPO_ROOT MAIN_ROOT

# ── Personal hook ─────────────────────────────────────────────────────────────
for hook in "$REPO_ROOT/bootstrap.local.sh" "$MAIN_ROOT/bootstrap.local.sh"; do
  if [ -f "$hook" ]; then
    echo "→ Personal hook ($hook)"
    bash "$hook"
    break
  fi
done

# ── Env file: create .env.local from .env.example if it is missing ────────────
# Never overwrites an existing file. The two secrets that only need to be
# random locally are generated; the OIDC credentials stay empty, because
# ALLOW_DEV_SIGN_IN covers local sign-in.
echo "→ Env file"
if [ ! -e .env.local ]; then
  sed \
    -e "s|^AUTH_SECRET=\"\"|AUTH_SECRET=\"$(openssl rand -base64 32)\"|" \
    -e "s|^INTEGRATION_KEY=\"\"|INTEGRATION_KEY=\"$(openssl rand -base64 32)\"|" \
    .env.example > .env.local
  echo "  ✓ created .env.local from .env.example, with AUTH_SECRET and INTEGRATION_KEY generated"
fi

# ── Local working files (gitignored) ──────────────────────────────────────────
if [ ! -e .local ] && [ ! -L .local ]; then
  mkdir .local
  echo "→ Created .local/ for local working files"
fi

if [ "$RUN_INSTALL" -eq 1 ]; then
  echo "→ Installing dependencies"
  pnpm install
else
  echo "→ Skipping install (--no-install)"
fi

echo "✓ Ready. For a local database: pnpm db:up && pnpm db:migrate && pnpm seed"
