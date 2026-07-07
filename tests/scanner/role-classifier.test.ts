import { describe, expect, it } from 'vitest';
import { classifyFile, type Role } from '../../src/scanner/role-classifier.js';

describe('classifyFile', () => {
  const cases: Array<[path: string, role: Role]> = [
    ['apps/api/src/users/users.controller.ts', 'CONTROLLER'],
    ['apps/api/src/users/users.service.ts', 'SERVICE'],
    ['apps/api/src/users/users.repository.ts', 'REPOSITORY'],
    ['apps/api/src/users/users.repo.ts', 'REPOSITORY'],
    ['apps/web/app/api/billing/usage/route.ts', 'ROUTE_HANDLER'],
    ['apps/web/pages/api/webhook.ts', 'API_HANDLER'],
    ['apps/web/server/api/routers/user.ts', 'TRPC_ROUTER'],
    ['apps/web/app/dashboard/actions.ts', 'SERVER_ACTION'],
    ['apps/web/app/dashboard/action.ts', 'SERVER_ACTION'],
    ['apps/worker/src/email.worker.ts', 'WORKER'],
    ['apps/web/lib/reply.prompt.ts', 'PROMPT_FILE'],
    ['packages/db/src/client.ts', 'DB_MODULE'],
    ['packages/shared/src/utils.ts', 'SHARED'],
    ['apps/web/src/db/queries.ts', 'DATA_ACCESS'],
    ['apps/web/components/Button.tsx', 'COMPONENT'],
    ['apps/web/README.md', 'UNKNOWN'],
    ['apps/web/utils/format.ts', 'UNKNOWN'],
  ];

  it.each(cases)('classifies %s as %s', (path, expectedRole) => {
    expect(classifyFile(path).role).toBe(expectedRole);
  });

  it('classifies a .test.tsx as TEST, not COMPONENT (order matters)', () => {
    expect(classifyFile('apps/web/components/Button.test.tsx').role).toBe('TEST');
  });

  it('normalizes Windows separators', () => {
    expect(classifyFile('apps\\api\\src\\users\\users.service.ts').role).toBe('SERVICE');
  });

  it('returns confidence 0 and null rule for unknown files', () => {
    const result = classifyFile('LICENSE');
    expect(result.role).toBe('UNKNOWN');
    expect(result.confidence).toBe(0);
    expect(result.matchedRule).toBeNull();
  });

  it('gives specific suffixes higher confidence than the generic component fallback', () => {
    expect(classifyFile('a.service.ts').confidence).toBeGreaterThan(
      classifyFile('a.tsx').confidence,
    );
  });
});
