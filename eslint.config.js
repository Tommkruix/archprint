import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'ab/**',
      'tests/fixtures/**',
      'docs/.vitepress/dist/**',
      'docs/.vitepress/cache/**',
      '.changeset/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  { rules: { 'no-empty': ['error', { allowEmptyCatch: true }] } },
);
