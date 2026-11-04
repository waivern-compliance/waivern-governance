/**
 * Formats and lints only the staged files, with the same tools and options as
 * `pnpm format` and `pnpm lint`. lint-staged runs globs in parallel, so they
 * must not overlap; the commands within one glob run in order.
 *
 * @type {import('lint-staged').Configuration}
 */
const config = {
  '*.{js,cjs,mjs,jsx,ts,tsx}': [
    'prettier --write',
    'eslint --fix --max-warnings 0 --no-warn-ignored'
  ],
  '*.mdx': 'prettier --write'
};

export default config;
