import eslintComments from '@eslint-community/eslint-plugin-eslint-comments';
import js from '@eslint/js';
import vitestPlugin from '@vitest/eslint-plugin';
import prettierConfig from 'eslint-config-prettier';
import importX from 'eslint-plugin-import-x';
import n from 'eslint-plugin-n';
import perfectionist from 'eslint-plugin-perfectionist';
import promise from 'eslint-plugin-promise';
import regexp from 'eslint-plugin-regexp';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import newspaperOrder from './eslint-rules/newspaper-order.mjs';

export default defineConfig(
  {
    // telegram-relay/ is a separate deployable (Cloudflare Worker, its own runtime and
    // secrets) — not part of this npm project's tsconfig, so typed linting can't reach it.
    ignores: ['dist', 'coverage', 'node_modules', '.husky', 'public', 'data', 'telegram-relay'],
  },

  { linterOptions: { reportUnusedDisableDirectives: 'error' } },

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  unicorn.configs.recommended,
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  n.configs['flat/recommended-module'],
  sonarjs.configs.recommended,
  promise.configs['flat/recommended'],
  regexp.configs['flat/recommended'],

  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      sourceType: 'module',
    },
    plugins: { local: { rules: { 'newspaper-order': newspaperOrder } } },
    rules: {
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          minimumDescriptionLength: 20,
          'ts-check': false,
          'ts-expect-error': 'allow-with-description',
          'ts-ignore': true,
          'ts-nocheck': true,
        },
      ],
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'as', objectLiteralTypeAssertions: 'never' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: true }],
      // `expect(() => voidFn()).toThrow()` is the standard vitest idiom, not a mistake.
      '@typescript-eslint/no-confusing-void-expression': [
        'error',
        { ignoreVoidReturningFunctions: true },
      ],
      // State is keyed `Record<ProductId | ListId, T>` by design (D10) — deleting a domain
      // entity means deleting a dynamic key, throughout every future slice's service layer.
      '@typescript-eslint/no-dynamic-delete': 'off',
      // A no-op arrow/function (default/optional sinks, test doubles, not-yet-implemented
      // stubs) is a legitimate pattern here, not dead code.
      '@typescript-eslint/no-empty-function': ['error', { allow: ['arrowFunctions', 'functions'] }],
      '@typescript-eslint/no-floating-promises': 'error',
      // `_list`, `_products` etc. mark an intentionally-unused stub parameter (§ "S" files:
      // signature now, body pending) — matches TypeScript's own noUnusedParameters convention.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/strict-boolean-expressions': ['error', { allowNullableObject: true }],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      'import-x/no-cycle': ['error', { maxDepth: Infinity }],
      // False positive on every CJS-interop default import (pino, the eslint plugins
      // below) that also happens to expose a same-named member — e.g. `pino.destination`.
      'import-x/no-named-as-default': 'off',

      'import-x/no-named-as-default-member': 'off',
      'local/newspaper-order': 'error',
      // The whole scaffold's stub strategy (§ "S" files) is a signature plus a marker
      // comment citing the decision it's waiting on (§x / Dn) — see root CLAUDE.md.
      'sonarjs/todo-tag': 'off',
      // `strictDirFsync` mirrors the STRICT_DIR_FSYNC env var name (§7); an is/has prefix
      // would just diverge from that without adding clarity.
      'unicorn/consistent-boolean-name': 'off',
      // `dir`, `fd`, `tempPath` etc. are standard Node fs vocabulary — the D7 write path
      // (dirFd, fsyncDir, strictDirFsync) uses these names throughout the architecture doc.
      'unicorn/name-replacements': 'off',
      'unicorn/no-null': 'off',
      // Cheap, no real friction; off items live in the "deliberately off" block below.
      'unicorn/prevent-abbreviations': 'off',
    },
    settings: {
      'import-x/resolver': {
        typescript: true,
      },
    },
  },

  perfectionist.configs['recommended-natural'],

  // sort-classes/sort-modules demand name-based declaration order; local/newspaper-order
  // demands call-graph order instead. The two are mutually exclusive — this repo picks
  // newspaper order and turns the name-based ones off rather than fight forever.
  {
    files: ['**/*.ts', '**/*.mjs'],
    rules: {
      'perfectionist/sort-classes': 'off',
      'perfectionist/sort-modules': 'off',
    },
  },

  {
    files: ['**/*.test.ts'],
    plugins: { vitest: vitestPlugin },
    rules: {
      ...vitestPlugin.configs.recommended.rules,
      // `let x; beforeEach(() => { x = ...; })` is the standard shared-fixture pattern.
      'unicorn/no-top-level-assignment-in-function': 'off',
      'vitest/expect-expect': 'error',
      'vitest/no-disabled-tests': 'error',
      'vitest/no-focused-tests': 'error',
    },
  },

  {
    extends: [tseslint.configs.disableTypeChecked],
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: { ...globals.node },
      sourceType: 'module',
    },
    plugins: { local: { rules: { 'newspaper-order': newspaperOrder } } },
    rules: {
      'local/newspaper-order': 'error',
    },
  },

  // D18: services never take FastifyRequest — keeps a service callable with no HTTP dependency.
  {
    files: ['src/slices/**/*.service.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['fastify', 'fastify/*', '@fastify/*'],
              message: 'Services never take FastifyRequest (D18). Keep HTTP in *.routes.ts.',
            },
          ],
        },
      ],
    },
  },

  // The debounced-flush timer state (flushOptions/flushTimer/dirty) is deliberately
  // module-level, reassigned from scheduleTelegramFlush()/flushNow()/performFlush() — the
  // same rebind-on-write shape store.ts uses for `state`/`sinks` below, just for the
  // Telegram-flush seam instead of the store seam.
  {
    files: ['src/shared/persistence/index.ts'],
    rules: {
      'unicorn/no-top-level-assignment-in-function': 'off',
    },
  },

  // §6.1: store.ts stays dependency-free — sinks are injected via configureStore(), not imported.
  {
    files: ['src/shared/state/store.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../persistence/*', '../../slices/*'],
              message:
                'store.ts imports only ./types.js — sinks are injected via configureStore() (§6.1).',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          message:
            'Never capture state at module scope — mutate() rebinds it (§6.1). Call getState() per read.',
          selector:
            "Program > VariableDeclaration > VariableDeclarator > CallExpression[callee.name='getState']",
        },
      ],
      // The module-level `state`/`sinks` rebind IS the design (§6.1, D8) — mutate() must
      // reassign them, not mutate in place, so a throwing mutator leaves state untouched.
      'unicorn/no-top-level-assignment-in-function': 'off',
    },
  },

  // Vertical slices don't reach into each other; shared code goes in shared/. Named
  // explicitly (rather than a `../*/` glob) because a single-`*` glob also matches the
  // `../../shared/...` imports every slice legitimately makes — `..` then `..` then `shared`
  // contains `../shared/` as a substring, which a naive glob happily matches.
  {
    files: ['src/slices/*/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../catalog/*', '../events/*'],
              message: 'Slices are vertical. Share via src/shared/.',
            },
          ],
        },
      ],
    },
  },

  // src/index.ts (§3.2, D6) and src/openapi.ts (--check in CI) are CLI entry points where
  // process.exit() is the specified behaviour.
  {
    files: ['src/index.ts', 'src/openapi.ts'],
    rules: {
      'n/no-process-exit': 'off',
      'unicorn/no-process-exit': 'off',
    },
  },

  // D7 requires a synchronous fsync'd write inside every mutation.
  {
    files: ['src/shared/persistence/local.ts'],
    rules: {
      'n/no-sync': 'off',
    },
  },

  {
    plugins: { '@eslint-community/eslint-comments': eslintComments },
    rules: {
      '@eslint-community/eslint-comments/disable-enable-pair': ['error', { allowWholeFile: false }],
      '@eslint-community/eslint-comments/no-aggregating-enable': 'error',
      '@eslint-community/eslint-comments/no-duplicate-disable': 'error',
      '@eslint-community/eslint-comments/no-unlimited-disable': 'error',
      '@eslint-community/eslint-comments/no-unused-disable': 'error',
      '@eslint-community/eslint-comments/require-description': ['error', { ignore: [] }],
    },
  },

  prettierConfig,

  // The flat-config plugins above are conventionally consumed as `import x from 'pkg'` then
  // `x.configs.foo` even though they also export named `configs` — a known false-positive
  // for import-x's default-export heuristics, not a real bug. Must come last to win over
  // importX.flatConfigs.recommended's own setting of these two rules.
  {
    files: ['eslint.config.mjs'],
    rules: {
      'import-x/no-named-as-default': 'off',
      'import-x/no-named-as-default-member': 'off',
    },
  },
);
