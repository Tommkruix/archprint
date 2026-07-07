import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  // ab/ is gitignored local tooling plus vendored third-party repo clones; it is not part of
  // the published project and must not be linted with the library's config.
  // Test fixtures are intentionally non-idiomatic sample inputs, not code to lint.
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'ab/**', 'tests/fixtures/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
);
