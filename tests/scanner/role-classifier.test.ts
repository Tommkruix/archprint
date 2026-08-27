import { describe, expect, it } from 'vitest';
import {
  classifyFile,
  classifyFileWithDirective,
  hasUseServerDirective,
  type Role,
} from '../../src/scanner/role-classifier.js';

describe('classifyFile', () => {
  const cases: Array<[path: string, role: Role]> = [
    ['apps/api/src/users/users.controller.ts', 'CONTROLLER'],
    ['apps/api/src/users/users.service.ts', 'SERVICE'],
    ['apps/api/src/users/users.repository.ts', 'REPOSITORY'],
    ['apps/api/src/users/users.repo.ts', 'REPOSITORY'],
    ['apps/web/app/api/billing/usage/route.ts', 'ROUTE_HANDLER'],
    ['apps/web/app/api/og/workout/route.tsx', 'ROUTE_HANDLER'],
    ['apps/web/pages/api/webhook.ts', 'API_HANDLER'],
    ['apps/web/pages/api/og.tsx', 'API_HANDLER'],
    ['apps/web/server/api/routers/user.ts', 'TRPC_ROUTER'],
    ['src/routes/api/users/+server.ts', 'API_HANDLER'],
    ['src/routes/dashboard/+page.server.ts', 'SERVER_ACTION'],
    ['src/routes/+layout.server.ts', 'SERVER_ACTION'],
    ['src/hooks.server.ts', 'ROUTE_HANDLER'],
    ['src/routes/blog/+page.ts', 'ROUTE_ENTRY'],
    ['server/api/users.ts', 'API_HANDLER'],
    ['server/middleware/auth.ts', 'API_HANDLER'],
    ['app/routes/_index.tsx', 'ROUTE_ENTRY'],
    ['app/routes/posts.$id.tsx', 'ROUTE_ENTRY'],
    ['app/root.tsx', 'ROUTE_ENTRY'],
    ['app/entry.server.tsx', 'ROUTE_ENTRY'],
    ['apps/web/app/dashboard/actions.ts', 'SERVER_ACTION'],
    ['apps/web/app/dashboard/action.ts', 'SERVER_ACTION'],
    ['apps/web/app/dashboard/page.tsx', 'ROUTE_ENTRY'],
    ['apps/web/app/(marketing)/about/layout.tsx', 'ROUTE_ENTRY'],
    ['apps/web/app/loading.tsx', 'ROUTE_ENTRY'],
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

describe('use-server directive detection', () => {
  it('detects a top-of-file directive, ignoring leading comments', () => {
    expect(hasUseServerDirective('"use server";\nimport x from "y";')).toBe(true);
    expect(hasUseServerDirective("// header\n'use server'\n")).toBe(true);
    expect(hasUseServerDirective('/* license\n block */\n"use server";')).toBe(true);
    expect(hasUseServerDirective('import x from "y";\n"use server";')).toBe(false);
    expect(hasUseServerDirective('export const x = 1;')).toBe(false);
    expect(hasUseServerDirective('/* unterminated comment "use server"')).toBe(false);
    expect(hasUseServerDirective('// line comment, no newline, then EOF')).toBe(false);
  });

  it('is linear on a comment-heavy head (no catastrophic backtracking)', () => {
    const pathological = '/*x*/ '.repeat(200) + '!';
    const start = Date.now();
    expect(hasUseServerDirective(pathological)).toBe(false);
    expect(Date.now() - start).toBeLessThan(100);
  });
});

describe('classifyFileWithDirective', () => {
  it('upgrades an UNKNOWN .ts module with a directive to SERVER_ACTION', () => {
    const r = classifyFileWithDirective('utils/actions/create-user.ts', true);
    expect(r.role).toBe('SERVER_ACTION');
    expect(r.matchedRule).toBe('use-server-directive');
  });

  it('never upgrades a .tsx page/component, even with a directive', () => {
    expect(classifyFileWithDirective('modules/x/settings/page.tsx', true).role).toBe('COMPONENT');
  });

  it('leaves a named path role (route handler) unchanged', () => {
    expect(classifyFileWithDirective('app/api/x/route.ts', true).role).toBe('ROUTE_HANDLER');
  });

  it('is a no-op without a directive', () => {
    expect(classifyFileWithDirective('utils/helper.ts', false).role).toBe('UNKNOWN');
  });
});
