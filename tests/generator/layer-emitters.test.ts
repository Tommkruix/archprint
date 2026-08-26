import { describe, expect, it } from 'vitest';
import {
  evaluateGate,
  type LayerBoundary,
  toDependencyCruiser,
  toEslintBoundaries,
} from '../../src/index.js';

function boundary(from: string, to: string, roleFileCount: number): LayerBoundary {
  const gate = evaluateGate({ roleFileCount, violatingFileCount: 0, roleConfidence: 1 });
  return {
    id: 'AP-LAYER',
    name: `no-import:${from}->${to}`,
    from,
    to,
    description: 'x',
    stats: {
      roleFileCount,
      conformingFileCount: roleFileCount,
      violatingFileCount: 0,
      ratio: 1,
      roleConfidence: 1,
    },
    gate,
    violations: [],
    reverseFlow: 20,
  };
}

describe('toDependencyCruiser', () => {
  it('emits one forbidden rule per AUTO boundary, scoped to layer paths', () => {
    const config = toDependencyCruiser([boundary('utils', 'components', 40)]);
    expect(config.forbidden).toHaveLength(1);
    const rule = config.forbidden[0]!;
    expect(rule.name).toBe('no-utils-to-components');
    expect(rule.from.path).toBe('(^|/)utils/');
    expect(rule.to.path).toBe('(^|/)components/');
    expect(rule.severity).toBe('error');
  });

  it('emits only AUTO boundaries by default, and SUGGEST when asked', () => {
    const list = [boundary('a', 'b', 40), boundary('c', 'd', 10)];
    expect(list.map((entry) => entry.gate.status)).toEqual(['AUTO', 'SUGGEST']);
    expect(toDependencyCruiser(list).forbidden).toHaveLength(1);
    expect(toDependencyCruiser(list, ['AUTO', 'SUGGEST']).forbidden).toHaveLength(2);
  });
});

describe('toEslintBoundaries', () => {
  it('emits element types and per-layer disallow rules for AUTO boundaries', () => {
    const config = toEslintBoundaries([
      boundary('utils', 'api', 40),
      boundary('utils', 'components', 40),
      boundary('components', 'features', 40),
    ]);
    const elements = config.settings['boundaries/elements'].map((element) => element.type);
    expect(elements).toEqual(['api', 'components', 'features', 'utils']);

    const rules = config.rules['boundaries/element-types'][1].rules;
    expect(config.rules['boundaries/element-types'][1].default).toBe('allow');
    expect(rules.find((rule) => rule.from[0] === 'utils')!.disallow).toEqual(['api', 'components']);
    expect(rules.find((rule) => rule.from[0] === 'components')!.disallow).toEqual(['features']);
  });
});
