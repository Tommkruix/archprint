/**
 * Architectural role inferred from a file's path/name. Roles cover NestJS, Next.js App Router
 * and Pages Router, tRPC, and common monorepo package conventions.
 */
export type Role =
  | 'CONTROLLER'
  | 'SERVICE'
  | 'REPOSITORY'
  | 'ROUTE_HANDLER'
  | 'SERVER_ACTION'
  | 'API_HANDLER'
  | 'TRPC_ROUTER'
  | 'DATA_ACCESS'
  | 'DB_MODULE'
  | 'WORKER'
  | 'PROMPT_FILE'
  | 'SHARED'
  | 'TEST'
  | 'COMPONENT'
  | 'UNKNOWN';

export interface RoleClassification {
  role: Role;
  /** 0..1: how specifically the path signals the role (named suffix > structural path > `.tsx`). */
  confidence: number;
  /** Id of the rule that matched, or null when unclassified. */
  matchedRule: string | null;
}

interface RoleRule {
  role: Role;
  id: string;
  test: RegExp;
  confidence: number;
}

// First match wins; TEST precedes COMPONENT so a `.test.tsx` is not read as a component.
const ROLE_RULES: readonly RoleRule[] = [
  { role: 'TEST', id: 'test-spec-suffix', test: /\.(test|spec)\.(ts|tsx)$/, confidence: 1 },
  { role: 'CONTROLLER', id: 'controller-suffix', test: /\.controller\.ts$/, confidence: 1 },
  { role: 'SERVICE', id: 'service-suffix', test: /\.service\.ts$/, confidence: 1 },
  { role: 'REPOSITORY', id: 'repository-suffix', test: /\.(repository|repo)\.ts$/, confidence: 1 },
  {
    role: 'WORKER',
    id: 'worker-job-queue-suffix',
    test: /\.(worker|job|queue)\.ts$/,
    confidence: 1,
  },
  { role: 'PROMPT_FILE', id: 'prompt-skill-suffix', test: /\.(prompt|skill)\.ts$/, confidence: 1 },
  {
    role: 'ROUTE_HANDLER',
    id: 'next-app-router-route',
    test: /app\/api\/.*\/route\.ts$/,
    confidence: 0.95,
  },
  { role: 'API_HANDLER', id: 'next-pages-api', test: /pages\/api\/.*\.ts$/, confidence: 0.95 },
  {
    role: 'TRPC_ROUTER',
    id: 'trpc-router',
    test: /server\/api\/routers\/.*\.ts$/,
    confidence: 0.95,
  },
  {
    role: 'SERVER_ACTION',
    id: 'next-server-action',
    test: /app\/.*\/actions?\.ts$/,
    confidence: 0.9,
  },
  { role: 'DB_MODULE', id: 'db-package', test: /packages\/(db|database)\//, confidence: 0.9 },
  { role: 'SHARED', id: 'shared-package', test: /packages\/shared\//, confidence: 0.9 },
  {
    role: 'DATA_ACCESS',
    id: 'db-directory',
    test: /(\/db\/|\/database\/|\/prisma\/)/,
    confidence: 0.8,
  },
  { role: 'COMPONENT', id: 'tsx-component', test: /\.tsx$/, confidence: 0.5 },
];

/**
 * Classify a repo-relative file path into an architectural role. Accepts either POSIX or
 * Windows separators. Returns UNKNOWN with confidence 0 when no rule matches.
 */
export function classifyFile(relativePath: string): RoleClassification {
  const normalizedPath = relativePath.replace(/\\/g, '/');
  for (const rule of ROLE_RULES) {
    if (rule.test.test(normalizedPath)) {
      return { role: rule.role, confidence: rule.confidence, matchedRule: rule.id };
    }
  }
  return { role: 'UNKNOWN', confidence: 0, matchedRule: null };
}

/** A module-level `"use server"` directive as the first statement (ignoring comments/blank lines). */
const USE_SERVER_DIRECTIVE = /^(?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)\s*)*["']use server["']/;

export function hasUseServerDirective(sourceHead: string): boolean {
  return USE_SERVER_DIRECTIVE.test(sourceHead);
}

/**
 * Path-based role, upgraded to SERVER_ACTION when a `.ts` module declares a top-level `"use server"`
 * directive (a Next.js server-action module). `.tsx` files are never upgraded: a page/component with
 * a `"use server"` directive still renders UI and legitimately imports components, so treating it as
 * a server-entry would be wrong. A named path role (controller, route, test) also always wins.
 */
export function classifyFileWithDirective(
  relativePath: string,
  hasServerDirective: boolean,
): RoleClassification {
  const base = classifyFile(relativePath);
  const isTsx = /\.tsx$/.test(relativePath.replace(/\\/g, '/'));
  if (hasServerDirective && base.role === 'UNKNOWN' && !isTsx) {
    return { role: 'SERVER_ACTION', confidence: 0.9, matchedRule: 'use-server-directive' };
  }
  return base;
}
