import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'tests/fixtures/**'],
    environment: 'node',
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/cli.ts'],
      reporter: ['text-summary', 'text'],
      thresholds: { lines: 99, functions: 100, branches: 87, statements: 98 },
    },
  },
});
