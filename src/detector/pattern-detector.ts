import { createImportAnalyzer, walkRepo } from '../scanner/file-walker.js';
import type { Role } from '../scanner/role-classifier.js';
import { evaluateGate, type GateResult } from './confidence-gate.js';

export const REQUEST_ENTRY_ROLES: readonly Role[] = [
  'CONTROLLER',
  'ROUTE_HANDLER',
  'SERVER_ACTION',
  'API_HANDLER',
  'TRPC_ROUTER',
];

/** Matched against both the import specifier and its resolved leaf path. */
export const DEFAULT_DB_MARKERS: readonly RegExp[] = [
  /@prisma\/client/,
  /generated\/prisma\/client/,
  /(^|\/)utils\/prisma(\/|\.|$)/,
  /(^|\/)prisma\/client/,
  /drizzle-orm/,
  /(^|\/)typeorm(\/|$)/,
  /(^|\/)mongoose(\/|$)/,
  /(^|\/)sequelize(\/|$)/,
];

const INFRA_PATH = /(^|\/)(health|seed|admin|webhook|webhooks|migration|migrations|cron)(\/|\.|$)/;

export interface PatternConfig {
  id: string;
  name: string;
  description: string;
  roles: readonly Role[];
  forbidden: readonly RegExp[];
}

export interface Violation {
  file: string;
  specifier: string;
  leaf: string;
}

export interface DetectedPattern {
  id: string;
  name: string;
  description: string;
  roles: readonly Role[];
  stats: {
    roleFileCount: number;
    conformingFileCount: number;
    violatingFileCount: number;
    ratio: number;
    roleConfidence: number;
  };
  gate: GateResult;
  violations: Violation[];
  infraCaution: boolean;
  infraExceptions: string[];
}

const NODE_MODULES = /[/\\]node_modules[/\\]/;

const matchesAny = (text: string, markers: readonly RegExp[]): boolean =>
  markers.some((marker) => marker.test(text));

/**
 * A value import hits a forbidden target when its specifier matches a marker, or when it resolves
 * to a first-party leaf that matches. Leaves under node_modules are excluded: a dependency's own
 * internal folders (e.g. next's `dist/client/components`) must not be read as our layers.
 */
function forbiddenTargetReachedByValue(
  imp: { specifier: string; valueLeafPaths: string[] },
  forbidden: readonly RegExp[],
): string | null {
  if (matchesAny(imp.specifier, forbidden)) return imp.specifier;
  const leaf = imp.valueLeafPaths.find(
    (path) => !NODE_MODULES.test(path) && matchesAny(path, forbidden),
  );
  return leaf ?? null;
}

/** Detect whether files of the given roles import a forbidden target as a value, then run the gate. */
export function detectForbiddenImport(appDir: string, config: PatternConfig): DetectedPattern {
  const roleFiles = walkRepo(appDir).filter((file) => config.roles.includes(file.role));
  const analyze = createImportAnalyzer(appDir);

  const violations: Violation[] = [];
  let confidenceSum = 0;
  for (const file of roleFiles) {
    confidenceSum += file.confidence;
    let imports: { specifier: string; valueLeafPaths: string[] }[];
    try {
      imports = analyze(file.absolutePath);
    } catch {
      imports = [];
    }
    for (const imp of imports) {
      const leaf = forbiddenTargetReachedByValue(imp, config.forbidden);
      if (leaf !== null) {
        violations.push({ file: file.relativePath, specifier: imp.specifier, leaf });
        break;
      }
    }
  }

  const roleFileCount = roleFiles.length;
  const violatingFiles = [...new Set(violations.map((violation) => violation.file))];
  const violatingFileCount = violatingFiles.length;
  const roleConfidence = roleFileCount === 0 ? 0 : confidenceSum / roleFileCount;
  const gate = evaluateGate({ roleFileCount, violatingFileCount, roleConfidence });
  const infraExceptions = violatingFiles.filter((file) => INFRA_PATH.test(file));

  return {
    id: config.id,
    name: config.name,
    description: config.description,
    roles: config.roles,
    stats: {
      roleFileCount,
      conformingFileCount: roleFileCount - violatingFileCount,
      violatingFileCount,
      ratio: gate.conditions.ratio.value,
      roleConfidence: gate.conditions.roleConfidence.value,
    },
    gate,
    violations,
    infraCaution: violatingFileCount > 0 && infraExceptions.length === violatingFileCount,
    infraExceptions,
  };
}

export function detectNoDbInRequestEntry(
  appDir: string,
  options: { dbMarkers?: readonly RegExp[] } = {},
): DetectedPattern {
  return detectForbiddenImport(appDir, {
    id: 'AP-001',
    name: 'no-direct-db-in-request-entry',
    description:
      'Request-entry files must not import a database client directly; go through a service or data-access layer.',
    roles: REQUEST_ENTRY_ROLES,
    forbidden: options.dbMarkers ?? DEFAULT_DB_MARKERS,
  });
}
