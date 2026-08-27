import { describe, expect, it } from 'vitest';
import {
  type UiDataIsolationAnalysis,
  evaluateGate,
  toDependencyCruiserUiData,
} from '../../src/index.js';

function analysis(componentCount: number, offenderCount: number): UiDataIsolationAnalysis {
  return {
    appDir: 'x',
    componentCount,
    offenderCount,
    gate: evaluateGate({
      roleFileCount: componentCount,
      violatingFileCount: offenderCount,
      roleConfidence: 1,
    }),
    violations: [],
  };
}

describe('toDependencyCruiserUiData', () => {
  it('emits a rule forbidding components from importing the data layer when clean (AUTO)', () => {
    const config = toDependencyCruiserUiData(analysis(40, 0));
    expect(config.forbidden).toHaveLength(1);
    expect(config.forbidden[0]!.name).toBe('no-ui-to-data');
    expect(config.forbidden[0]!.from.path).toContain('tsx');
  });

  it('emits nothing with no components or below AUTO', () => {
    expect(toDependencyCruiserUiData(analysis(0, 0)).forbidden).toEqual([]);
    expect(toDependencyCruiserUiData(analysis(5, 3)).forbidden).toEqual([]);
  });
});
