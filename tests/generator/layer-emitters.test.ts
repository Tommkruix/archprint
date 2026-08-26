import { describe, expect, it } from 'vitest';
import { evaluateGate, type LayerBoundary, toDependencyCruiser } from '../../src/index.js';

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
