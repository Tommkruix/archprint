import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'tests/fixtures/**'],
    environment: 'node',
    // The CLI's deep tests run the TypeScript type checker; under coverage instrumentation a single project
    // load can exceed the 5s default. This bound only engages when a test genuinely runs long.
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // cli.ts is the executable bin shim (argv + process.exit); its logic lives in cli/program.ts.
      exclude: ['src/cli.ts'],
      reporter: ['text-summary', 'text'],
      // Ratchet at the achieved level: raise these, never lower them. The gap to 100% is short-circuit
      // (`||`/`??`) branch-halves and defensive fs/parse catches, marked with `v8 ignore` where relevant.
      thresholds: { lines: 99, functions: 100, branches: 87, statements: 98 },
    },
  },
});
