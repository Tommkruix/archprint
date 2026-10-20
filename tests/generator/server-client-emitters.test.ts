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
    clients: [],
    serverModules: [],
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
  it('forbids the client files importing the server modules, never a server module importing server-only', () => {
    const rule = toDependencyCruiserServerClient(
      {
        ...analysis(40, 0),
        clients: ['components/chat.tsx'],
        serverModules: ['lib/db.ts'],
      },
      'apps/web',
      () => ['components/legacy.tsx'],
    ).forbidden[0]!;
    expect(rule.name).toBe('no-server-only-in-client');
    const from = new RegExp(rule.from.path);
    expect(from.test('apps/web/components/chat.tsx')).toBe(true);
    expect(from.test('apps/web/lib/db.ts')).toBe(false);
    const to = [rule.to.path].flat().map((source) => new RegExp(source));
    const reaches = (target: string): boolean => to.some((pattern) => pattern.test(target));
    expect(reaches('apps/web/lib/db.ts')).toBe(true);
    expect(reaches('node_modules/server-only/index.js')).toBe(true);
    expect(reaches('apps/web/lib/other.ts')).toBe(false);
    const exempt = [rule.from.pathNot].flat().map((source) => new RegExp(source));
    expect(exempt.some((pattern) => pattern.test('apps/web/components/legacy.tsx'))).toBe(true);
    expect(rule.to.dependencyTypesNot).toEqual(['type-only']);
  });

  it('emits nothing with no client modules or below AUTO', () => {
    expect(toDependencyCruiserServerClient(analysis(0, 0), '.', () => []).forbidden).toEqual([]);
    expect(toDependencyCruiserServerClient(analysis(5, 3), '.', () => []).forbidden).toEqual([]);
  });
});
