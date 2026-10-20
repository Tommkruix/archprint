import { hasLeadingDirective } from './directives.js';

export type Role =
  | 'CONTROLLER'
  | 'SERVICE'
  | 'REPOSITORY'
  | 'ROUTE_HANDLER'
  | 'ROUTE_ENTRY'
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
  confidence: number;
  matchedRule: string | null;
}

interface RoleRule {
  role: Role;
  id: string;
  test: RegExp;
  confidence: number;
}

const ROLE_RULES: readonly RoleRule[] = [
  {
    role: 'TEST',
    id: 'test-spec-suffix',
    test: /\.(test|spec|e2e-spec|e2e)\.(ts|tsx)$/,
    confidence: 1,
  },
  {
    role: 'TEST',
    id: 'test-directory',
    test: /(^|\/)(__tests__|__mocks__|e2e|cypress|playwright|test|tests)\//,
    confidence: 0.95,
  },
  { role: 'UNKNOWN', id: 'generated-code', test: /(^|\/)generated\//, confidence: 0.5 },
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
  { role: 'COMPONENT', id: 'angular-component', test: /\.component\.ts$/, confidence: 0.9 },
  { role: 'COMPONENT', id: 'angular-directive', test: /\.directive\.ts$/, confidence: 0.85 },
  { role: 'COMPONENT', id: 'vue-sfc', test: /\.vue$/, confidence: 0.9 },
  { role: 'COMPONENT', id: 'svelte-sfc', test: /\.svelte$/, confidence: 0.9 },
  {
    role: 'ROUTE_HANDLER',
    id: 'next-app-router-route',
    test: /app\/api\/.*\/route\.tsx?$/,
    confidence: 0.95,
  },
  { role: 'API_HANDLER', id: 'next-pages-api', test: /pages\/api\/.*\.tsx?$/, confidence: 0.95 },
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
  { role: 'API_HANDLER', id: 'sveltekit-endpoint', test: /(^|\/)\+server\.ts$/, confidence: 0.95 },
  {
    role: 'SERVER_ACTION',
    id: 'sveltekit-page-server',
    test: /(^|\/)\+(page|layout)\.server\.ts$/,
    confidence: 0.9,
  },
  {
    role: 'ROUTE_HANDLER',
    id: 'sveltekit-hooks',
    test: /(^|\/)hooks\.server\.ts$/,
    confidence: 0.85,
  },
  {
    role: 'ROUTE_ENTRY',
    id: 'sveltekit-load',
    test: /(^|\/)\+(page|layout)\.ts$/,
    confidence: 0.8,
  },
  {
    role: 'API_HANDLER',
    id: 'nuxt-nitro-server',
    test: /(^|\/)server\/(api|routes|middleware|plugins)\/.*\.ts$/,
    confidence: 0.85,
  },
  {
    role: 'ROUTE_ENTRY',
    id: 'remix-route',
    test: /(^|\/)app\/routes\/.*\.tsx?$/,
    confidence: 0.85,
  },
  {
    role: 'ROUTE_ENTRY',
    id: 'remix-root',
    test: /(^|\/)app\/(root|entry\.(server|client))\.tsx?$/,
    confidence: 0.85,
  },
  { role: 'DB_MODULE', id: 'db-package', test: /packages\/(db|database)\//, confidence: 0.9 },
  { role: 'SHARED', id: 'shared-package', test: /packages\/shared\//, confidence: 0.9 },
  {
    role: 'DATA_ACCESS',
    id: 'db-directory',
    test: /(\/db\/|\/database\/|\/prisma\/)/,
    confidence: 0.8,
  },
  {
    role: 'DATA_ACCESS',
    id: 'db-client-file',
    test: /(^|\/)(prisma|drizzle|kysely)\.[cm]?[jt]sx?$/,
    confidence: 0.8,
  },
  {
    role: 'ROUTE_ENTRY',
    id: 'next-app-router-entry',
    test: /(^|\/)app\/(.*\/)?(page|layout|template|loading|error|not-found|default|global-error)\.tsx?$/,
    confidence: 0.9,
  },
  { role: 'COMPONENT', id: 'tsx-component', test: /\.tsx$/, confidence: 0.5 },
];

export const ROLE_PATTERNS: ReadonlyMap<Role, readonly RegExp[]> = ROLE_RULES.reduce(
  (map, rule) => {
    const patterns = map.get(rule.role) ?? [];
    patterns.push(rule.test);
    return map.set(rule.role, patterns);
  },
  new Map<Role, RegExp[]>(),
);

export const REQUEST_ENTRY_ROLES: readonly Role[] = [
  'CONTROLLER',
  'ROUTE_HANDLER',
  'SERVER_ACTION',
  'API_HANDLER',
  'TRPC_ROUTER',
];

/** The index of the first rule whose pattern matches the path, or -1. Self-contained: the ESLint rules embed it. */
export function firstMatchingRule(
  relativePath: string,
  rules: readonly { test: RegExp }[],
): number {
  const normalizedPath = relativePath.replace(/\\/g, '/');
  return rules.findIndex((rule) => rule.test.test(normalizedPath));
}

/** The role rules in the order classifyFile tries them, as regex sources. */
export const ROLE_RULE_SOURCES: readonly { role: Role; source: string }[] = ROLE_RULES.map(
  (rule) => ({ role: rule.role, source: rule.test.source }),
);

export function classifyFile(relativePath: string): RoleClassification {
  const rule = ROLE_RULES[firstMatchingRule(relativePath, ROLE_RULES)];
  return rule === undefined
    ? { role: 'UNKNOWN', confidence: 0, matchedRule: null }
    : { role: rule.role, confidence: rule.confidence, matchedRule: rule.id };
}

export const hasUseServerDirective = (sourceHead: string): boolean =>
  hasLeadingDirective(sourceHead, 'use server');

export const hasUseClientDirective = (sourceHead: string): boolean =>
  hasLeadingDirective(sourceHead, 'use client');

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
