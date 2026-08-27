import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  detectForbiddenImport,
  detectForbiddenImports,
  inferDbClientMarkers,
  REQUEST_ENTRY_ROLES,
  type PatternConfig,
} from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const barrel = path.join(here, '..', 'fixtures', 'db-barrel');

const dbConfig = (): PatternConfig => ({
  id: 'AP-001',
  name: 'no-db-client-in-request-entry',
  description: 'x',
  roles: REQUEST_ENTRY_ROLES,
  forbidden: inferDbClientMarkers(barrel).markers,
});

describe('detectForbiddenImports (shared pass)', () => {
  it('gives the same result as the single-pattern detector', () => {
    const config = dbConfig();
    const [shared] = detectForbiddenImports(barrel, [config]);
    const single = detectForbiddenImport(barrel, config);
    expect(shared!.stats).toEqual(single.stats);
    expect(shared!.gate.status).toEqual(single.gate.status);
  });

  it('deep resolution catches a barrel-hidden import that fast (specifier-level) misses', () => {
    const config = dbConfig();
    const [fast] = detectForbiddenImports(barrel, [config], { resolve: false });
    const [deep] = detectForbiddenImports(barrel, [config], { resolve: true });
    expect(fast!.stats.violatingFileCount).toBe(0);
    expect(deep!.stats.violatingFileCount).toBe(1);
  });

  it('applies each config only to files whose role it targets', () => {
    const configs: PatternConfig[] = [
      {
        id: 'A',
        name: 'a',
        description: 'd',
        roles: ['ROUTE_HANDLER'],
        forbidden: [/never-matches/],
      },
      { id: 'B', name: 'b', description: 'd', roles: ['SERVICE'], forbidden: [/never-matches/] },
    ];
    const [routes, services] = detectForbiddenImports(barrel, configs);
    expect(routes!.stats.roleFileCount).toBeGreaterThan(0);
    expect(services!.stats.roleFileCount).toBe(0);
  });
});
