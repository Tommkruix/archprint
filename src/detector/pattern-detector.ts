import { createImportAnalyzer, walkRepo } from '../scanner/file-walker.js';
import type { Role } from '../scanner/role-classifier.js';
import { evaluateGate, type GateResult } from './confidence-gate.js';
import {
  inferDbClientMarkers,
  inferUiLayerMarkers,
  KNOWN_DB_LIBRARIES,
  type InferredDbMarkers,
  type InferredMarkers,
} from './marker-inference.js';

export const REQUEST_ENTRY_ROLES: readonly Role[] = [
  'CONTROLLER',
  'ROUTE_HANDLER',
  'SERVER_ACTION',
  'API_HANDLER',
  'TRPC_ROUTER',
];

/** Known db libraries only; first-party wrappers are inferred (see inferDbClientMarkers). */
export const DEFAULT_DB_MARKERS: readonly RegExp[] = KNOWN_DB_LIBRARIES;

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
      /* v8 ignore next -- defensive: a file that fails to parse contributes no imports */
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

  return buildPattern(config, violations, roleFiles.length, confidenceSum);
}

function buildPattern(
  config: PatternConfig,
  violations: Violation[],
  roleFileCount: number,
  confidenceSum: number,
): DetectedPattern {
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

/**
 * Detect several patterns in one pass: walk the repo and resolve each role file's imports once, testing
 * every config's markers against the shared result. Much faster than calling detectForbiddenImport per
 * pattern, which re-resolves the same files each time.
 */
export function detectForbiddenImports(
  appDir: string,
  configs: readonly PatternConfig[],
  options: { resolve?: boolean } = {},
): DetectedPattern[] {
  const roleUnion = new Set(configs.flatMap((config) => [...config.roles]));
  const roleFiles = walkRepo(appDir).filter((file) => roleUnion.has(file.role));
  const analyze = createImportAnalyzer(appDir, { resolve: options.resolve ?? true });

  const accumulators = configs.map((config) => ({
    config,
    violations: [] as Violation[],
    roleFileCount: 0,
    confidenceSum: 0,
  }));
  for (const file of roleFiles) {
    let imports: { specifier: string; valueLeafPaths: string[] }[];
    try {
      imports = analyze(file.absolutePath);
    } catch {
      /* v8 ignore next -- defensive: a file that fails to parse contributes no imports */
      imports = [];
    }
    for (const accumulator of accumulators) {
      if (!accumulator.config.roles.includes(file.role)) continue;
      accumulator.roleFileCount += 1;
      accumulator.confidenceSum += file.confidence;
      for (const imp of imports) {
        const leaf = forbiddenTargetReachedByValue(imp, accumulator.config.forbidden);
        if (leaf !== null) {
          accumulator.violations.push({ file: file.relativePath, specifier: imp.specifier, leaf });
          break;
        }
      }
    }
  }
  return accumulators.map((accumulator) =>
    buildPattern(
      accumulator.config,
      accumulator.violations,
      accumulator.roleFileCount,
      accumulator.confidenceSum,
    ),
  );
}

/** Detect the server-entry-to-UI boundary with the UI marker inferred from this repo's graph. */
export function detectUiLayerInServerEntry(
  appDir: string,
): DetectedPattern & { inferredUi: InferredMarkers } {
  const inferredUi = inferUiLayerMarkers(appDir);
  const result = detectForbiddenImport(appDir, {
    id: 'AP-002',
    name: 'no-ui-layer-in-server-entry',
    description:
      'A server-entry file must not import from the UI layer (inferred from where components live in this repo).',
    roles: REQUEST_ENTRY_ROLES,
    forbidden: inferredUi.markers,
  });
  // No identifiable UI layer: reject rather than emit a vacuous AUTO on zero markers.
  if (inferredUi.markers.length === 0) {
    result.gate = { ...result.gate, status: 'REJECT', passes: false };
  }
  return { ...result, inferredUi };
}

/** Detect the request-entry-to-db-client boundary with markers inferred from this repo's graph. */
export function detectDbClientInRequestEntry(
  appDir: string,
): DetectedPattern & { inferredDb: InferredDbMarkers } {
  const inferredDb = inferDbClientMarkers(appDir);
  const result = detectForbiddenImport(appDir, {
    id: 'AP-001',
    name: 'no-db-client-in-request-entry',
    description:
      'A request-entry file must not import the database client directly; go through a service or data-access layer.',
    roles: REQUEST_ENTRY_ROLES,
    forbidden: inferredDb.markers,
  });
  return { ...result, inferredDb };
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
