import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { inferDbClientMarkers, inferUiLayerMarkers } from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'ui-infer');

describe('inferUiLayerMarkers', () => {
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

  it('discovers a pg wrapper via new Pool() but not a types-only importer', () => {
    const inferred = inferDbClientMarkers(fixtureFor('db-pg'));
    expect(inferred.wrappers).toContain('@/db/pool');
    expect(inferred.wrappers).not.toContain('@/lib/query');
  });

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

  it('does not treat a type-only db re-export as a wrapper', () => {
    const inferred = inferDbClientMarkers(fixtureFor('db-type-reexport'));
    expect(inferred.wrappers).toHaveLength(0);
    expect(inferred.markers.some((marker) => marker.test('@/lib/types'))).toBe(false);
  });
});

describe('inferUiLayerMarkers selection', () => {
  it('excludes colocated tests so they do not dilute the component directory', () => {
    const inferred = inferUiLayerMarkers(path.join(here, '..', 'fixtures', 'ui-colocated-tests'));
    expect(inferred.segments).toEqual(['components']);
  });

  it('selects the encompassing layer over a nested primitive kit', () => {
    const inferred = inferUiLayerMarkers(path.join(here, '..', 'fixtures', 'ui-nested-kit'));
    expect(inferred.segments).toEqual(['components']);
  });

  it('identifies components by rendered JSX, not the .tsx extension', () => {
    const inferred = inferUiLayerMarkers(path.join(here, '..', 'fixtures', 'ui-jsx-detect'));
    expect(inferred.segments).toEqual(['components']);
  });

  it('does not mistake a page-heavy feature area for the UI layer', () => {
    const inferred = inferUiLayerMarkers(path.join(here, '..', 'fixtures', 'ui-page-heavy'));
    expect(inferred.segments).toEqual(['components']);
  });

  it('picks the directory holding the most components among unrelated siblings', () => {
    const inferred = inferUiLayerMarkers(path.join(here, '..', 'fixtures', 'ui-feature'));
    expect(inferred.segments).toEqual(['settings']);
  });
});
