/** @typedef  {import("prettier").Config} PrettierConfig */

/**
 * The same rules as waivern-web's `@workspace/prettier-config`, with the
 * import groups adapted to this repo's `@/` alias.
 *
 * @type { PrettierConfig }
 */
const config = {
  endOfLine: 'auto',
  semi: true,
  useTabs: false,
  singleQuote: true,
  jsxSingleQuote: false,
  tabWidth: 2,
  trailingComma: 'none',
  bracketSpacing: true,
  arrowParens: 'always',
  singleAttributePerLine: true,
  importOrder: [
    '^(react/(.*)$)|^(react$)',
    '^(next/(.*)$)|^(next$)',
    '<THIRD_PARTY_MODULES>',
    '^types$',
    '',
    '^@/(.*)$',
    '',
    '^[./]'
  ],
  importOrderParserPlugins: ['typescript', 'jsx', 'decorators-legacy'],
  tailwindStylesheet: './src/app/globals.css',
  plugins: [
    'prettier-plugin-tailwindcss',
    '@ianvs/prettier-plugin-sort-imports'
  ]
};

export default config;
