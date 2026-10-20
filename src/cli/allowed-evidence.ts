import { evaluateGate, wilsonLowerBound } from '../detector/confidence-gate.js';
import { importedEntries } from '../detector/entry-purity-detector.js';
import { layerRuleName } from '../generator/layer-emitters.js';
import { DEPENDENCY_INTERNALS_RULE } from '../generator/dependency-internals-emitters.js';
import { ENTRY_PURITY_RULE } from '../generator/entry-purity-emitters.js';
import { PHANTOM_DEPENDENCY_RULE } from '../generator/phantom-dependency-emitters.js';
import { SERVER_CLIENT_RULE } from '../generator/server-client-emitters.js';
import { publicApiRuleName } from '../generator/public-api-emitters.js';
import { NO_CYCLES_RULE, readAdoptedRules } from './adopted-rules.js';
import { allowedFilesByRule, readAllowed } from './allowed-exceptions.js';
import type { ScanResult } from './scan.js';

type AllowedByRule = ReadonlyMap<string, readonly string[]>;

interface Excluded<T> {
  kept: T[];
  removedFiles: number;
  keptFiles: number;
}

function exclude<T extends { file: string }>(
  violations: readonly T[],
  allowedFiles: readonly string[],
): Excluded<T> {
  const allowed = new Set(allowedFiles);
  const kept = violations.filter((violation) => !allowed.has(violation.file));
  const distinct = (list: readonly T[]): number => new Set(list.map((item) => item.file)).size;
  return { kept, removedFiles: distinct(violations) - distinct(kept), keptFiles: distinct(kept) };
}

const regate = (population: number, violating: number, roleConfidence = 1, applicable = true) =>
  evaluateGate({
    roleFileCount: population,
    violatingFileCount: violating,
    roleConfidence,
    applicable,
  });

function regatedCycles(scan: ScanResult, allowedFiles: readonly string[]) {
  const analysis = scan.cycles;
  const allowed = new Set(allowedFiles);
  const cycles = analysis.cycles.filter((cycle) => !cycle.files.every((file) => allowed.has(file)));
  if (cycles.length === analysis.cycles.length) return analysis;
  const filesInCycles = new Set(cycles.flatMap((cycle) => cycle.files)).size;
  return { ...analysis, cycles, filesInCycles, gate: regate(analysis.fileCount, filesInCycles) };
}

function regatedInternals(scan: ScanResult, allowedFiles: readonly string[]) {
  const analysis = scan.dependencyInternals;
  const internals = exclude(analysis.violations, allowedFiles);
  if (internals.removedFiles === 0) return analysis;
  const externalImporterCount = analysis.externalImporterCount - internals.removedFiles;
  return {
    ...analysis,
    externalImporterCount,
    offenderCount: internals.keptFiles,
    violations: internals.kept,
    gate: regate(externalImporterCount, internals.keptFiles),
  };
}

/** Allowed importers leave the evidence; an entry still counts while another file imports it. */
function regatedEntryPurity(scan: ScanResult, allowedImporters: readonly string[]) {
  const analysis = scan.entryPurity;
  const allowed = new Set(allowedImporters);
  const imports = analysis.imports.filter((entry) => !allowed.has(entry.importer));
  if (imports.length === analysis.imports.length) return analysis;
  const violations = importedEntries(imports);
  return {
    ...analysis,
    imports,
    violations,
    offenderCount: violations.length,
    gate: regate(analysis.entryCount, violations.length),
  };
}

function regatedPhantom(scan: ScanResult, allowedFiles: readonly string[]) {
  const analysis = scan.phantomDependencies;
  const phantom = exclude(analysis.violations, allowedFiles);
  if (phantom.removedFiles === 0) return analysis;
  const externalImporterCount = analysis.externalImporterCount - phantom.removedFiles;
  return {
    ...analysis,
    externalImporterCount,
    offenderCount: phantom.keptFiles,
    violations: phantom.kept,
    gate: regate(externalImporterCount, phantom.keptFiles),
  };
}

function regatedServerClient(scan: ScanResult, allowedFiles: readonly string[]) {
  const analysis = scan.serverClient;
  const boundary = exclude(analysis.violations, allowedFiles);
  if (boundary.removedFiles === 0) return analysis;
  const clientCount = analysis.clientCount - boundary.removedFiles;
  return {
    ...analysis,
    clientCount,
    offenderCount: boundary.keptFiles,
    violations: boundary.kept,
    gate: regate(clientCount, boundary.keptFiles, 1, analysis.serverModules.length > 0),
  };
}

/** Allowed files of the rules already adopted: an allowance can keep an adopted rule, never promote another. */
export function adoptedAllowances(outDir: string): AllowedByRule {
  let adopted: ReadonlySet<string>;
  try {
    adopted = new Set((readAdoptedRules(outDir) ?? []).map((rule) => rule.id));
  } catch {
    adopted = new Set();
  }
  return new Map(
    [...allowedFilesByRule(readAllowed(outDir))].filter(([rule]) => adopted.has(rule)),
  );
}

/**
 * The scan with each rule's allowed exceptions left out of its evidence: they are reviewed exceptions, so they
 * count neither for nor against the rule when it is re-inferred.
 */
export function excludeAllowed(scan: ScanResult, allowed: AllowedByRule): ScanResult {
  if (allowed.size === 0) return scan;
  const allowedFor = (rule: string): readonly string[] => allowed.get(rule) ?? [];

  const patterns = scan.patterns.map((pattern) => {
    const { kept, removedFiles, keptFiles } = exclude(
      pattern.result.violations,
      allowedFor(pattern.config.id),
    );
    if (removedFiles === 0) return pattern;
    const { stats } = pattern.result;
    const roleFileCount = stats.roleFileCount - removedFiles;
    const gate = regate(roleFileCount, keptFiles, stats.roleConfidence);
    const infraExceptions = pattern.result.infraExceptions.filter((file) =>
      kept.some((v) => v.file === file),
    );
    return {
      ...pattern,
      result: {
        ...pattern.result,
        violations: kept,
        gate,
        stats: {
          ...stats,
          roleFileCount,
          conformingFileCount: roleFileCount - keptFiles,
          violatingFileCount: keptFiles,
          ratio: gate.observedConformance,
        },
        infraExceptions,
        infraCaution: keptFiles > 0 && infraExceptions.length === keptFiles,
      },
    };
  });

  const consoleRule = exclude(scan.consoleIsolation.violations, allowedFor('console-isolation'));
  const libraryFileCount = scan.consoleIsolation.libraryFileCount - consoleRule.removedFiles;
  const deep = exclude(scan.deepRelative.violations, allowedFor('import-style'));
  const relativeImporterCount = scan.deepRelative.relativeImporterCount - deep.removedFiles;
  const tests = exclude(scan.testIsolation.violations, allowedFor('test-isolation'));
  const productionFileCount = scan.testIsolation.productionFileCount - tests.removedFiles;

  return {
    ...scan,
    patterns,
    consoleIsolation:
      consoleRule.removedFiles === 0
        ? scan.consoleIsolation
        : {
            ...scan.consoleIsolation,
            libraryFileCount,
            offenderCount: consoleRule.keptFiles,
            violations: consoleRule.kept,
            gate: regate(libraryFileCount, consoleRule.keptFiles),
          },
    deepRelative:
      deep.removedFiles === 0
        ? scan.deepRelative
        : {
            ...scan.deepRelative,
            relativeImporterCount,
            offenderCount: deep.keptFiles,
            violations: deep.kept,
            gate: regate(relativeImporterCount, deep.keptFiles),
          },
    testIsolation:
      tests.removedFiles === 0
        ? scan.testIsolation
        : {
            ...scan.testIsolation,
            productionFileCount,
            offenderCount: tests.keptFiles,
            violations: tests.kept,
            gate: regate(
              productionFileCount,
              tests.keptFiles,
              1,
              scan.testIsolation.testFileCount > 0,
            ),
          },
    publicApi: {
      ...scan.publicApi,
      groups: scan.publicApi.groups.map((group) => {
        const api = exclude(group.violations, allowedFor(publicApiRuleName(group.dir)));
        if (api.removedFiles === 0) return group;
        const consumerCount = group.consumerCount - api.removedFiles;
        return {
          ...group,
          consumerCount,
          deepImporterCount: api.keptFiles,
          violations: api.kept,
          gate: regate(consumerCount, api.keptFiles),
        };
      }),
    },
    cycles: regatedCycles(scan, allowedFor(NO_CYCLES_RULE)),
    phantomDependencies: regatedPhantom(scan, allowedFor(PHANTOM_DEPENDENCY_RULE)),
    dependencyInternals: regatedInternals(scan, allowedFor(DEPENDENCY_INTERNALS_RULE)),
    entryPurity: regatedEntryPurity(scan, allowedFor(ENTRY_PURITY_RULE)),
    serverClient: regatedServerClient(scan, allowedFor(SERVER_CLIENT_RULE)),
    layerBoundaries: scan.layerBoundaries.map((boundary) => {
      const layer = exclude(boundary.violations, allowedFor(layerRuleName(boundary)));
      if (layer.removedFiles === 0) return boundary;
      const roleFileCount = boundary.stats.roleFileCount - layer.removedFiles;
      const directional = wilsonLowerBound(
        boundary.reverseFlow,
        layer.keptFiles + boundary.reverseFlow,
      );
      const gate = regate(roleFileCount, layer.keptFiles, directional);
      return {
        ...boundary,
        violations: layer.kept,
        gate,
        stats: {
          ...boundary.stats,
          roleFileCount,
          conformingFileCount: roleFileCount - layer.keptFiles,
          violatingFileCount: layer.keptFiles,
          ratio: gate.observedConformance,
          roleConfidence: directional,
        },
      };
    }),
  };
}
