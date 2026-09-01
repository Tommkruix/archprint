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
  // A flat file named after a known ORM client is the data-access surface even without a db/ directory
  // (e.g. inbox-zero's utils/prisma.ts holds the Prisma client). Directory rules above miss these.
  {
    role: 'DATA_ACCESS',
    id: 'db-client-file',
    test: /(^|\/)(prisma|drizzle|kysely)\.[cm]?[jt]sx?$/,
    confidence: 0.8,
  },
  // Next.js App Router entry files render UI but are framework entry points, not reusable components; must
  // precede the `.tsx` component rule so a page is never counted as part of the shared UI layer.
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

export function classifyFile(relativePath: string): RoleClassification {
  const normalizedPath = relativePath.replace(/\\/g, '/');
  for (const rule of ROLE_RULES) {
    if (rule.test.test(normalizedPath)) {
      return { role: rule.role, confidence: rule.confidence, matchedRule: rule.id };
    }
  }
  return { role: 'UNKNOWN', confidence: 0, matchedRule: null };
}

const USE_SERVER_LITERAL = /^["']use server["']/;
const USE_CLIENT_LITERAL = /^["']use client["']/;
const isWhitespace = (c: string): boolean =>
  c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';

/**
 * Test the leading module directive against `literal`, allowing leading whitespace and comments. Scans
 * linearly (skipping whitespace, line comments, and block comments) rather than one backtracking regex: a
 * head full of comment tokens must never cause catastrophic backtracking (ReDoS). Only the final fixed-literal
 * check uses a regex.
 */
function hasLeadingDirective(sourceHead: string, literal: RegExp): boolean {
  let i = 0;
  const n = sourceHead.length;
  for (;;) {
    while (i < n && isWhitespace(sourceHead[i]!)) i++;
    if (sourceHead.startsWith('//', i)) {
      const newline = sourceHead.indexOf('\n', i);
      if (newline === -1) return false;
      i = newline + 1;
    } else if (sourceHead.startsWith('/*', i)) {
      const end = sourceHead.indexOf('*/', i + 2);
      if (end === -1) return false;
      i = end + 2;
    } else {
      break;
    }
  }
  return literal.test(sourceHead.slice(i));
}

export function hasUseServerDirective(sourceHead: string): boolean {
  return hasLeadingDirective(sourceHead, USE_SERVER_LITERAL);
}

export function hasUseClientDirective(sourceHead: string): boolean {
  return hasLeadingDirective(sourceHead, USE_CLIENT_LITERAL);
}

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
