import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeLayerReachability, reachesLayer } from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Fixture chain: api/handler -> service/svc -> db/client. api reaches db only through service (no direct
// import). db reaches nothing.
const fixture = path.join(here, '..', 'fixtures', 'reachability');
// reach-cycle: alpha/a and beta/b import each other (a cross-layer cycle), so each layer reaches the other
// and itself.
const cycleFixture = path.join(here, '..', 'fixtures', 'reach-cycle');

describe('computeLayerReachability', () => {
  it('follows a transitive chain across layers (api reaches db through service)', () => {
    const analysis = computeLayerReachability(fixture);
    expect(reachesLayer(analysis, 'api', 'service')).toBe(true);
    expect(reachesLayer(analysis, 'api', 'db')).toBe(true);
    expect(reachesLayer(analysis, 'service', 'db')).toBe(true);
  });

  it('does not invent reach in the clean direction (db reaches nothing)', () => {
    const analysis = computeLayerReachability(fixture);
    expect(reachesLayer(analysis, 'db', 'api')).toBe(false);
    expect(reachesLayer(analysis, 'db', 'service')).toBe(false);
    expect(reachesLayer(analysis, 'service', 'api')).toBe(false);
  });

  it('lists every layer present', () => {
    const analysis = computeLayerReachability(fixture);
    expect(analysis.layers).toEqual(['api', 'db', 'service']);
  });

  it('is robust to a relative appDir', () => {
    const relative = path.relative(process.cwd(), fixture);
    const analysis = computeLayerReachability(relative);
    expect(reachesLayer(analysis, 'api', 'db')).toBe(true);
  });

  it('makes both layers of a cross-layer cycle reach each other and themselves', () => {
    const analysis = computeLayerReachability(cycleFixture);
    expect(reachesLayer(analysis, 'alpha', 'beta')).toBe(true);
    expect(reachesLayer(analysis, 'beta', 'alpha')).toBe(true);
    expect(reachesLayer(analysis, 'alpha', 'alpha')).toBe(true);
    expect(reachesLayer(analysis, 'beta', 'beta')).toBe(true);
  });

  it('fast and deep modes agree', () => {
    const fast = computeLayerReachability(fixture, { resolve: false });
    const deep = computeLayerReachability(fixture, { resolve: true });
    expect(reachesLayer(deep, 'api', 'db')).toBe(reachesLayer(fast, 'api', 'db'));
    expect(deep.layers).toEqual(fast.layers);
  });
});
