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

describe('inferUiLayerMarkers selection', () => {
  // Colocated tests must not sink the UI layer: 6 components + 6 sibling tests would drop `components`
  // purity to 0.5 (below the gate) if tests counted; excluding scaffolding restores it.
  it('excludes colocated tests so they do not dilute the component directory', () => {
    const inferred = inferUiLayerMarkers(path.join(here, '..', 'fixtures', 'ui-colocated-tests'));
    expect(inferred.segments).toEqual(['components']);
  });

  // Coverage picks the encompassing `components` over a nested, heavily-importable primitive kit
  // `components/ui` (the case where raw import fan-in mis-selects the sub-library).
  it('selects the encompassing layer over a nested primitive kit', () => {
    const inferred = inferUiLayerMarkers(path.join(here, '..', 'fixtures', 'ui-nested-kit'));
    expect(inferred.segments).toEqual(['components']);
  });

  // AST component detection: a component renders JSX, it is not merely a `.tsx` file. A `generated/` dir
  // of 8 non-JSX `.tsx` type files would out-count `components/` (5) under the old extension rule and be
  // mis-selected; the JSX check excludes them, and `.ts` files that render via createElement DO count.
  it('identifies components by rendered JSX, not the .tsx extension', () => {
    const inferred = inferUiLayerMarkers(path.join(here, '..', 'fixtures', 'ui-jsx-detect'));
    expect(inferred.segments).toEqual(['components']);
  });

  // App Router entry files (page/layout) are not reusable components: a page-heavy feature area
  // (`dashboard`, 7 entries) must not out-cover the real `components` layer (5). Route-entry separation
  // keeps the pages out of the component count so `components` wins.
  it('does not mistake a page-heavy feature area for the UI layer', () => {
    const inferred = inferUiLayerMarkers(path.join(here, '..', 'fixtures', 'ui-page-heavy'));
    expect(inferred.segments).toEqual(['components']);
  });

  // Documented limitation: when a shared kit `ui/` (4) and a larger feature dir `settings/` (8) are
  // siblings with no common parent, coverage picks the larger `settings`. Separating a shared kit from
  // feature components needs AST-level component detection (planned). Fan-in used to pick `ui` here but
  // mis-selects primitive sub-libraries on real repos, so it was removed.
  it('picks the directory holding the most components among unrelated siblings', () => {
    const inferred = inferUiLayerMarkers(path.join(here, '..', 'fixtures', 'ui-feature'));
    expect(inferred.segments).toEqual(['settings']);
  });
});
