import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  detectForbiddenImport,
  detectForbiddenImports,
  type PatternConfig,
  REQUEST_ENTRY_ROLES,
} from '../../src/index.js';
import { createImportAnalyzer } from '../../src/scanner/file-walker.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'type-only-entry');

// Three request-entry routes import the same forbidden specifier: one as a runtime value
// (`import { PrismaClient }`), one as a whole-declaration type-only import (`import type { User }`),
// and one as an inline type-only named import (`import { type Prisma }`). Only the value import is a
// runtime dependency; the two type-only imports are erased and must not count.
const config: PatternConfig = {
  id: 'TEST',
  name: 'no-db-in-request-entry',
  description: 'test rule',
  roles: REQUEST_ENTRY_ROLES,
  forbidden: [/@prisma\/client/],
};

describe('type-only imports are not runtime dependencies', () => {
  it('flags only the value import in deep mode', () => {
    const result = detectForbiddenImport(fixture, config);
    expect(result.stats.roleFileCount).toBe(3);
    expect(result.violations.map((violation) => violation.file)).toEqual([
      'app/api/value/route.ts',
    ]);
  });

  // Regression: the specifier-only fast scan previously flagged type-only imports as violations.
  it('flags only the value import in fast mode', () => {
    const [fast] = detectForbiddenImports(fixture, [config], { resolve: false });
    expect(fast!.stats.roleFileCount).toBe(3);
    expect(fast!.stats.violatingFileCount).toBe(1);
  });

  it('hasValueBinding separates value from type-only imports without resolution', () => {
    const analyze = createImportAnalyzer(fixture, { resolve: false });
    const value = analyze(path.join(fixture, 'app/api/value/route.ts'));
    const typeOnly = analyze(path.join(fixture, 'app/api/typeonly/route.ts'));
    const inlineType = analyze(path.join(fixture, 'app/api/inline-type/route.ts'));
    expect(value.every((imp) => imp.hasValueBinding)).toBe(true);
    expect(typeOnly.every((imp) => !imp.hasValueBinding)).toBe(true);
    expect(inlineType.every((imp) => !imp.hasValueBinding)).toBe(true);
  });
});
