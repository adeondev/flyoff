import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { noNativeTitle } from './eslint-rules/no-native-title.mjs';

export default tseslint.config(
  {
    ignores: [
      '.webpack/**',
      'coverage/**',
      'node_modules/**',
      'out/**',
      'packages/native-core/build/**',
      'packages/native-core/target/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
    plugins: {
      'react-hooks': reactHooks,
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: {
      flyoff: {
        rules: {
          'no-native-title': noNativeTitle,
        },
      },
    },
    rules: {
      'flyoff/no-native-title': 'error',
    },
  },
  {
    files: [
      'packages/native-core/**/*.{cjs,js}',
      'scripts/benchmark-large-notes.cjs',
      'scripts/profile-source.cjs',
      'scripts/keystroke-latency.cjs',
      'scripts/scroll-anchor-probe.cjs',
    ],
    languageOptions: {
      globals: globals.node,
      sourceType: 'commonjs',
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
