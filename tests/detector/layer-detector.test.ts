import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectLayerBoundaries, evaluateGate, layerOfPath } from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Fixture layers: utils (clean, imported by both), components (import utils; one file leaks a features
// import), features (import components + utils). Expected clean boundaries: utils !-> components,
// utils !-> features. Expected leaky boundary: components !-> features (1 violation from list.ts).
const fixture = path.join(here, '..', 'fixtures', 'layers');
const boundary = (analysis: ReturnType<typeof detectLayerBoundaries>, from: string, to: string) =>
  analysis.boundaries.find((b) => b.from === from && b.to === to);

describe('layerOfPath', () => {
  it('takes the first non-structural directory segment', () => {
    expect(layerOfPath('src/features/programs/ui/card.tsx')).toBe('features');
    expect(layerOfPath('components/button.ts')).toBe('components');
    expect(layerOfPath('app/api/things/route.ts')).toBe('api');
    expect(layerOfPath('middleware.ts')).toBeNull();
  });
});

describe('detectLayerBoundaries', () => {
  it('assigns layers by directory with correct file counts', () => {
    const analysis = detectLayerBoundaries(fixture, { minLayerFiles: 3 });
    const counts = Object.fromEntries(analysis.layers.map((l) => [l.layer, l.fileCount]));
    expect(counts).toMatchObject({ utils: 3, components: 3, features: 3 });
  });

  it('infers the clean boundary direction (utils must not import components) with no violations', () => {
    const analysis = detectLayerBoundaries(fixture, { minLayerFiles: 3 });
    const uc = boundary(analysis, 'utils', 'components');
    expect(uc).toBeDefined();
    expect(uc!.stats.violatingFileCount).toBe(0);
    expect(uc!.reverseFlow).toBe(3);
    expect(uc!.gate.status).toBe(
      evaluateGate({ roleFileCount: 3, violatingFileCount: 0, roleConfidence: 1 }).status,
    );
  });

  it('counts the real leak on the components -> features boundary', () => {
    const analysis = detectLayerBoundaries(fixture, { minLayerFiles: 3 });
    const cf = boundary(analysis, 'components', 'features');
    expect(cf).toBeDefined();
    expect(cf!.stats.violatingFileCount).toBe(1);
    expect(cf!.violations.map((v) => v.file)).toContain('components/list.ts');
  });

  it('is robust to a relative appDir', () => {
    const relative = path.relative(process.cwd(), fixture);
    const analysis = detectLayerBoundaries(relative, { minLayerFiles: 3 });
    expect(boundary(analysis, 'utils', 'components')).toBeDefined();
  });

  it('gates a large, clean boundary to AUTO from relative imports (fast mode)', () => {
    // layer-auto: 40 "helpers" leaves + 5 "views" that import them via RELATIVE specifiers. helpers never
    // import views, so helpers !-> views is the clean minority direction, and 40 clean observations clear the
    // Wilson floor. Exercises the relative-specifier resolution and the same-layer/type-only skips.
    const dir = path.join(here, '..', 'fixtures', 'layer-auto');
    const analysis = detectLayerBoundaries(dir, { resolve: false });
    const hv = boundary(analysis, 'helpers', 'views');
    expect(hv).toBeDefined();
    expect(hv!.stats.violatingFileCount).toBe(0);
    expect(hv!.stats.roleFileCount).toBe(40);
    expect(hv!.gate.status).toBe('AUTO');
  });

  it('fast and deep modes agree on the clean boundary', () => {
    const fast = boundary(
      detectLayerBoundaries(fixture, { minLayerFiles: 3, resolve: false }),
      'utils',
      'components',
    );
    const deep = boundary(
      detectLayerBoundaries(fixture, { minLayerFiles: 3, resolve: true }),
      'utils',
      'components',
    );
    expect(deep).toBeDefined();
    expect(deep!.from).toBe('utils');
    expect(deep!.to).toBe('components');
    expect(deep!.stats.violatingFileCount).toBe(fast!.stats.violatingFileCount);
  });
});
