// One config for the whole workspace. `pnpm lint` runs it from the root;
// `pnpm --filter <pkg> lint` runs `eslint .` inside a package and ESLint walks
// up to find this file, so both give the same answer.
//
// Type-aware rules are deliberately off: they need a full TypeScript program
// per package and turn a two-second lint into a minute. `pnpm typecheck` is
// what catches type errors.
import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import nextPlugin from '@next/eslint-plugin-next';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default defineConfig([
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/coverage/',
    'frontend/.next/',
    'frontend/next-env.d.ts',
    'backend/prisma/migrations/',
  ]),

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      // An underscore prefix is the conventional way to say "this parameter
      // is part of the signature but unused here".
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
    },
  },

  // Plain-Node scripts and config files.
  {
    files: ['scripts/**/*.mjs', '**/*.config.{js,mjs}'],
    languageOptions: { globals: globals.node },
  },

  // Frontend: React hooks discipline and Next's own checks. The plugin is
  // registered under the name `react-hooks` on purpose — existing
  // `eslint-disable` comments refer to `react-hooks/exhaustive-deps`.
  {
    files: ['frontend/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, '@next/next': nextPlugin },
    settings: { next: { rootDir: 'frontend/' } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      // App Router: there is no pages/ directory for this rule to check.
      '@next/next/no-html-link-for-pages': 'off',
    },
  },

  // Last, so it wins: turns off every stylistic rule Prettier owns.
  prettier,
]);
