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
  /**
   * 0..1 heuristic: how strongly the path signals this role. A specific filename suffix
   * (`.service.ts`) is stronger than a structural path (`app/api/.../route.ts`), which is
   * stronger than a generic `.tsx`. This is a per-file signal, NOT the pattern-level
   * "role confidence" gate used in detection (that is the fraction of role files matching a
   * naming convention, computed later).
   */
  confidence: number;
  /** Id of the rule that matched, for debuggability. Null when unclassified. */
  matchedRule: string | null;
}

interface RoleRule {
  role: Role;
  id: string;
  test: RegExp;
  confidence: number;
}

/**
 * Ordered ruleset: FIRST match wins. Specific filename suffixes precede structural path
 * patterns, which precede the generic `.tsx` fallback. TEST precedes COMPONENT so that a
 * `.test.tsx` classifies as a test, not a component.
 */
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
