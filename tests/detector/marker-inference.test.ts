import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { inferDbClientMarkers, inferUiLayerMarkers } from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'ui-infer');

describe('inferUiLayerMarkers', () => {
  // Fixture's UI dir is named "widgets" (not components/ui) to prove the marker is graph-derived.
  it('discovers the UI layer from the graph even when it is not named components/ui', () => {
    const inferred = inferUiLayerMarkers(fixture);
    expect(inferred.segments).toEqual(['widgets']);
    const [marker] = inferred.markers;
    expect(marker).toBeDefined();
    expect(marker!.test('@/widgets/Button')).toBe(true);
    expect(marker!.test('../widgets/Card')).toBe(true);
    expect(marker!.test('@acme/widgets/Modal')).toBe(true);
    expect(marker!.test('@/server/handler')).toBe(false);
    expect(marker!.test('@/app/api/things/route')).toBe(false);
  });

  it('returns no marker when there are too few components to infer confidently', () => {
    const inferred = inferUiLayerMarkers(path.join(here, '..', 'fixtures', 'walker'));
    expect(inferred.markers).toHaveLength(0);
  });

  it('returns no marker when components live only under structural (routing) directories', () => {
    const inferred = inferUiLayerMarkers(path.join(here, '..', 'fixtures', 'ui-structural'));
    expect(inferred.segments).toEqual([]);
  });
});

describe('inferDbClientMarkers', () => {
  const fixtureFor = (name: string): string => path.join(here, '..', 'fixtures', name);

  it('discovers the first-party db wrapper that imports a known library', () => {
    const inferred = inferDbClientMarkers(fixture);
    expect(inferred.wrappers).toContain('@/server/db');
    expect(inferred.markers.some((marker) => marker.test('@/server/db'))).toBe(true);
    expect(inferred.markers.some((marker) => marker.test('@prisma/client'))).toBe(true);
    expect(inferred.markers.some((marker) => marker.test('@/widgets/Button'))).toBe(false);
  });

  // Gap 1: a pg client via `new Pool()` is found (generic constructor + a known-library import); a file
  // that only imports pg types is not a wrapper.
  it('discovers a pg wrapper via new Pool() but not a types-only importer', () => {
    const inferred = inferDbClientMarkers(fixtureFor('db-pg'));
    expect(inferred.wrappers).toContain('@/db/pool');
    expect(inferred.wrappers).not.toContain('@/lib/query');
  });

  // Gap 2: the instantiating file lives behind a barrel; the leaf-path marker matches the wrapper's file
  // path, so a barrel import the detector resolves to that leaf is flagged.
  it('emits a leaf-path marker so a barrel-re-exported client is catchable', () => {
    const dir = fixtureFor('db-barrel');
    const inferred = inferDbClientMarkers(dir);
    expect(inferred.wrappers).toContain('@/db/client');
    const leafPath = path.join(dir, 'src', 'db', 'client.ts');
    expect(inferred.markers.some((marker) => marker.test(leafPath.replace(/\\/g, '/')))).toBe(true);
  });

  it('discovers a db wrapper that lives in a sibling workspace package', () => {
    const inferred = inferDbClientMarkers(fixtureFor('monorepo-db/apps/web'));
    expect(inferred.wrappers).toContain('@acme/db');
  });
});

describe('inferUiLayerMarkers fan-in', () => {
  // Gap 3: settings/ has more components (8) than the shared ui/ (4), but ui/ is imported broadly, so
  // fan-in must pick ui/ over the feature directory.
  it('prefers the broadly-imported shared library over a larger feature directory', () => {
    const inferred = inferUiLayerMarkers(path.join(here, '..', 'fixtures', 'ui-feature'));
    expect(inferred.segments).toEqual(['ui']);
  });
});
