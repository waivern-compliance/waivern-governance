/**
 * Conventional Commits rules, applied to local commit messages (husky
 * `commit-msg` hook) and to PR titles in CI. PRs are squash-merged, so the PR
 * title becomes the commit on `main`.
 *
 * @type {import('@commitlint/types').UserConfig}
 */
const config = {
  extends: ['@commitlint/config-conventional']
};

export default config;
