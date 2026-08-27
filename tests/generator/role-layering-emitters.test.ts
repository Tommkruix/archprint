import { describe, expect, it } from 'vitest';
import {
  evaluateGate,
  type RoleBoundary,
  toDependencyCruiserRoleLayering,
} from '../../src/index.js';

function boundary(
  from: RoleBoundary['from'],
  to: RoleBoundary['to'],
  violating: number,
): RoleBoundary {
  const roleFileCount = 40;
  const gate = evaluateGate({ roleFileCount, violatingFileCount: violating, roleConfidence: 1 });
  return {
    from,
    to,
    roleFileCount,
    conformingFileCount: roleFileCount - violating,
    violatingFileCount: violating,
    reverseFlow: 30,
    roleConfidence: 1,
    gate,
    violations: [],
  };
}

describe('toDependencyCruiserRoleLayering', () => {
  it('emits a forbidden rule per AUTO boundary, scoped to the role path patterns', () => {
    const config = toDependencyCruiserRoleLayering([boundary('REPOSITORY', 'SERVICE', 0)]);
    expect(config.forbidden).toHaveLength(1);
    const rule = config.forbidden[0]!;
    expect(rule.name).toBe('no-repository-to-service');
    expect(rule.from.path).toContain('repository');
    expect(rule.to.path).toContain('service');
    expect(rule.severity).toBe('error');
  });

  it('emits only AUTO boundaries by default, and SUGGEST when asked', () => {
    const list = [boundary('REPOSITORY', 'SERVICE', 0), boundary('SERVICE', 'CONTROLLER', 6)];
    expect(list.map((b) => b.gate.status)).toEqual(['AUTO', 'SUGGEST']);
    expect(toDependencyCruiserRoleLayering(list).forbidden).toHaveLength(1);
    expect(toDependencyCruiserRoleLayering(list, ['AUTO', 'SUGGEST']).forbidden).toHaveLength(2);
  });
});
