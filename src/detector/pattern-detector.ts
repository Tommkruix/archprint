import { createImportAnalyzer, type ResolvedImport, walkRepo } from '../scanner/file-walker.js';
import { REQUEST_ENTRY_ROLES, type Role } from '../scanner/role-classifier.js';
import { evaluateGate, type GateResult } from './confidence-gate.js';
import {
  inferDbClientMarkers,
  inferUiLayerMarkers,
  KNOWN_DB_EXAMPLES,
  KNOWN_DB_LIBRARIES,
  type InferredDbMarkers,
  type InferredMarkers,
} from './marker-inference.js';

export { REQUEST_ENTRY_ROLES };

/** The forbidden-import rules' names, which ESLint prints as `archprint/<name>`. */
export const FORBIDDEN_IMPORT_RULE_NAMES: Readonly<Record<string, string>> = {
  'AP-001': 'no-db-client-in-request-entry',
  'AP-002': 'no-ui-layer-in-server-entry',
};

export const DEFAULT_DB_MARKERS: readonly RegExp[] = KNOWN_DB_LIBRARIES;

const INFRA_PATH = /(^|\/)(health|seed|admin|webhook|webhooks|migration|migrations|cron)(\/|\.|$)/;

export interface PatternConfig {
  id: string;
  name: string;
  description: string;
  roles: readonly Role[];
  forbidden: readonly RegExp[];
  examples?: readonly string[];
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

function forbiddenTargetReachedByValue(
  imp: { specifier: string; valueLeafPaths: string[]; hasValueBinding: boolean },
  forbidden: readonly RegExp[],
): string | null {
  if (imp.hasValueBinding && matchesAny(imp.specifier, forbidden)) return imp.specifier;
  const leaf = imp.valueLeafPaths.find(
    (path) => !NODE_MODULES.test(path) && matchesAny(path, forbidden),
  );
  return leaf ?? null;
}

export function detectForbiddenImport(appDir: string, config: PatternConfig): DetectedPattern {
  const roleFiles = walkRepo(appDir).filter((file) => config.roles.includes(file.role));
  const analyze = createImportAnalyzer(appDir);

  const violations: Violation[] = [];
  let confidenceSum = 0;
  for (const file of roleFiles) {
    confidenceSum += file.confidence;
    let imports: ResolvedImport[];
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
      ratio: gate.observedConformance,
      roleConfidence: gate.conditions.roleConfidence.value,
    },
    gate,
    violations,
    infraCaution: violatingFileCount > 0 && infraExceptions.length === violatingFileCount,
    infraExceptions,
  };
}

interface ForbiddenScan {
  config: PatternConfig;
  /** Every import of a role file that reaches a forbidden target, in file and source order. */
  occurrences: Violation[];
  roleFileCount: number;
  confidenceSum: number;
}

function scanForbiddenImports(
  appDir: string,
  configs: readonly PatternConfig[],
  options: { resolve?: boolean },
): ForbiddenScan[] {
  const roleUnion = new Set(configs.flatMap((config) => [...config.roles]));
  const roleFiles = walkRepo(appDir).filter((file) => roleUnion.has(file.role));
  const analyze = createImportAnalyzer(appDir, { resolve: options.resolve ?? true });

  const scans: ForbiddenScan[] = configs.map((config) => ({
    config,
    occurrences: [],
    roleFileCount: 0,
    confidenceSum: 0,
  }));
  for (const file of roleFiles) {
    let imports: ResolvedImport[];
    try {
      imports = analyze(file.absolutePath);
    } catch {
      /* v8 ignore next -- defensive: a file that fails to parse contributes no imports */
      imports = [];
    }
    for (const scan of scans) {
      if (!scan.config.roles.includes(file.role)) continue;
      scan.roleFileCount += 1;
      scan.confidenceSum += file.confidence;
      for (const imp of imports) {
        const leaf = forbiddenTargetReachedByValue(imp, scan.config.forbidden);
        if (leaf !== null) {
          scan.occurrences.push({ file: file.relativePath, specifier: imp.specifier, leaf });
        }
      }
    }
  }
  return scans;
}

/** The first forbidden import of each file: the evidence a pattern reports. */
const firstPerFile = (occurrences: readonly Violation[]): Violation[] => {
  const seen = new Set<string>();
  return occurrences.filter((violation) => {
    if (seen.has(violation.file)) return false;
    seen.add(violation.file);
    return true;
  });
};

export function detectForbiddenImports(
  appDir: string,
  configs: readonly PatternConfig[],
  options: { resolve?: boolean } = {},
): DetectedPattern[] {
  return scanForbiddenImports(appDir, configs, options).map((scan) =>
    buildPattern(
      scan.config,
      firstPerFile(scan.occurrences),
      scan.roleFileCount,
      scan.confidenceSum,
    ),
  );
}

/** Every forbidden import of each config's role files, the way the rules enforce: one entry per import. */
export function forbiddenImportOccurrences(
  appDir: string,
  configs: readonly PatternConfig[],
  options: { resolve?: boolean } = {},
): Violation[][] {
  return scanForbiddenImports(appDir, configs, options).map((scan) => scan.occurrences);
}

export function detectUiLayerInServerEntry(
  appDir: string,
): DetectedPattern & { inferredUi: InferredMarkers } {
  const inferredUi = inferUiLayerMarkers(appDir);
  const result = detectForbiddenImport(appDir, {
    id: 'AP-002',
    name: 'no-ui-layer-in-server-entry',
    description:
      'A request handler must not import UI components (found from where components live in this repo).',
    roles: REQUEST_ENTRY_ROLES,
    forbidden: inferredUi.markers,
    examples: inferredUi.examples,
  });
  if (inferredUi.markers.length === 0) {
    result.gate = { ...result.gate, status: 'REJECT', passes: false };
  }
  return { ...result, inferredUi };
}

export function detectDbClientInRequestEntry(
  appDir: string,
): DetectedPattern & { inferredDb: InferredDbMarkers } {
  const inferredDb = inferDbClientMarkers(appDir);
  const result = detectForbiddenImport(appDir, {
    id: 'AP-001',
    name: 'no-db-client-in-request-entry',
    description:
      'A request handler must not import the database client directly; go through a service or data-access layer.',
    roles: REQUEST_ENTRY_ROLES,
    forbidden: inferredDb.markers,
    examples: inferredDb.examples,
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
      'Request handlers must not import a database client directly; go through a service or data-access layer.',
    roles: REQUEST_ENTRY_ROLES,
    forbidden: options.dbMarkers ?? DEFAULT_DB_MARKERS,
    ...(options.dbMarkers === undefined && { examples: KNOWN_DB_EXAMPLES }),
  });
}
