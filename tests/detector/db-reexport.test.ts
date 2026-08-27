import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  detectForbiddenImport,
  detectForbiddenImports,
  inferDbClientMarkers,
  type PatternConfig,
  REQUEST_ENTRY_ROLES,
} from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'db-reexport');

describe('db-client marker inference follows re-exports of a known db library', () => {
  it('infers the first-party re-export file (@/lib/db) as a db-client surface', () => {
    expect(inferDbClientMarkers(fixture).wrappers).toContain('@/lib/db');
  });

  it('flags a request entry importing the re-exported client, in both scan modes', () => {
    const config: PatternConfig = {
      id: 'AP-001',
      name: 'no-db-client-in-request-entry',
      description: 'test rule',
      roles: REQUEST_ENTRY_ROLES,
      forbidden: inferDbClientMarkers(fixture).markers,
    };
    const [fast] = detectForbiddenImports(fixture, [config], { resolve: false });
    const deep = detectForbiddenImport(fixture, config);
    expect(fast!.stats.roleFileCount).toBe(2);
    expect(fast!.stats.violatingFileCount).toBe(1);
    expect(deep.stats.violatingFileCount).toBe(1);
    expect(deep.violations.map((violation) => violation.file)).toContain('app/api/things/route.ts');
  });
});
