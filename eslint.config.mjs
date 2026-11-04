import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import eslintConfigPrettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';

// Built from its code point, so this file doesn't trip its own rule.
const EM_DASH = String.fromCodePoint(0x2014);

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Formatting is Prettier's job; turn off the rules that would fight it.
  eslintConfigPrettier,
  {
    rules: {
      // Shared with waivern-web: copy uses hyphens.
      'no-restricted-syntax': [
        'error',
        ...[
          `Literal[value=/${EM_DASH}/]`,
          `TemplateElement[value.raw=/${EM_DASH}/]`,
          `JSXText[value=/${EM_DASH}/]`
        ].map((selector) => ({
          selector,
          message: `Use a hyphen (-) instead of an em dash (${EM_DASH}) in copy.`
        }))
      ],
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_[^_].*$|^_$',
          varsIgnorePattern: '^_[^_].*$|^_$',
          caughtErrorsIgnorePattern: '^_[^_].*$|^_$'
        }
      ]
    }
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts'
  ])
]);

export default eslintConfig;
