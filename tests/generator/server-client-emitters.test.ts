import { describe, expect, it } from 'vitest';
import {
  type ServerClientAnalysis,
  evaluateGate,
  toDependencyCruiserServerClient,
} from '../../src/index.js';

function analysis(clientCount: number, offenderCount: number): ServerClientAnalysis {
  return {
    appDir: 'x',
    clientCount,
    offenderCount,
    gate: evaluateGate({
      roleFileCount: clientCount,
      violatingFileCount: offenderCount,
      roleConfidence: 1,
    }),
    violations: [],
  };
}

describe('toDependencyCruiserServerClient', () => {
  it('emits a rule forbidding server-only in client code when clean (AUTO)', () => {
    const config = toDependencyCruiserServerClient(analysis(40, 0));
    expect(config.forbidden).toHaveLength(1);
    expect(config.forbidden[0]!.name).toBe('no-server-only-in-client');
    expect(config.forbidden[0]!.to.path).toContain('server-only');
  });

  it('emits nothing with no client modules or below AUTO', () => {
    expect(toDependencyCruiserServerClient(analysis(0, 0)).forbidden).toEqual([]);
    expect(toDependencyCruiserServerClient(analysis(5, 3)).forbidden).toEqual([]);
  });
});
