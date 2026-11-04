#!/usr/bin/env bash
# check-branch-name.sh — fail unless the given branch name follows the repo's
# naming convention. Used by the pre-push hook and the PR conventions workflow.
#
# Usage: scripts/check-branch-name.sh <branch>
set -euo pipefail

branch="${1:?usage: $0 <branch>}"

case "$branch" in
  # Dependabot names its own branches.
  dependabot/*) exit 0 ;;
esac

if [[ "$branch" =~ ^(feature|fix|docs|refactor|chore|test|ci|build|perf)/[a-z0-9][a-z0-9._-]*$ ]]; then
  exit 0
fi

cat >&2 <<EOF
✗ Branch name '$branch' does not follow the convention.
  Use <type>/<kebab-case-description>, where <type> is one of:
  feature, fix, docs, refactor, chore, test, ci, build, perf
  e.g. feature/organisation-invites, fix/login-redirect
EOF
exit 1
