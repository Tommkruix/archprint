import * as path from 'node:path';
import { allowedFilesByRule, readAllowed } from './allowed-exceptions.js';
import { exemptionPaths } from '../generator/eslint-scope.js';
import { writeOwnedFile } from '../generator/owned-paths.js';
import { toDependencyCruiser, toEslintBoundaries } from '../generator/layer-emitters.js';
import { toDependencyCruiserPublicApi } from '../generator/public-api-emitters.js';
import { toDependencyCruiserFeatureSlice } from '../generator/feature-slice-emitters.js';
import {
  toDependencyCruiserTestIsolation,
  toEslintTestIsolation,
} from '../generator/test-isolation-emitters.js';
import { toDependencyCruiserAppIsolation } from '../generator/app-isolation-emitters.js';
import { toDependencyCruiserDependencyInternals } from '../generator/dependency-internals-emitters.js';
import { toDependencyCruiserRoleLayering } from '../generator/role-layering-emitters.js';
import { toDependencyCruiserEntryPurity } from '../generator/entry-purity-emitters.js';
import { toDependencyCruiserPhantomDependencies } from '../generator/phantom-dependency-emitters.js';
import type { InstalledEnforcers } from '../scanner/enforcers.js';
import { toEslintDeepRelative } from '../generator/deep-relative-emitters.js';
import { toEslintConsoleIsolation } from '../generator/console-isolation-emitters.js';
import { toEslintEnvAccess } from '../generator/env-access-emitters.js';
import { toEslintWorkspacePackageApi } from '../generator/workspace-package-emitters.js';
import { toDependencyCruiserStoriesIsolation } from '../generator/stories-isolation-emitters.js';
import { toDependencyCruiserUiData } from '../generator/ui-data-isolation-emitters.js';
import { toDependencyCruiserServerClient } from '../generator/server-client-emitters.js';
import { toGraphviz, toMermaid } from '../generator/graph-emitters.js';
import { renderTsArchTests, type BoundaryRule } from '../generator/tsarch-emitter.js';
import { emitRuleArtifacts } from '../generator/rule-generator.js';
import {
  buildForbiddenImportSpecs,
  renderEslintPluginSource,
  type ForbiddenImportSpec,
} from '../generator/eslint-plugin-emitter.js';
import { renderEslintPreset } from '../generator/eslint-preset-emitter.js';
import {
  mergeNoRestrictedImports,
  type NoRestrictedImportsBlock,
} from '../generator/eslint-scope.js';
import type { ScannedPattern, ScanResult } from './scan.js';
import {
  consoleIsolationRule,
  forbiddenImportRule,
  importStyleRule,
  publicApiRules,
  testIsolationRule,
  writeAdoptedRules,
  type AdoptedRule,
  type ResolutionMode,
} from './adopted-rules.js';

export const ESLINT_FILE = 'eslint.mjs';
export const DEPCRUISE_FILE = 'dependency-cruiser.json';
export const ARCHPRINT_DIR = '.archprint';

export const FAMILY_NAMES = [
  'forbidden-imports',
  'layer',
  'role-layering',
  'public-api',
  'feature-slice',
  'app-isolation',
  'test-isolation',
  'dependency-hygiene',
  'entry-purity',
  'phantom-deps',
  'import-style',
  'console',
  'env-access',
  'workspace-package',
  'stories-isolation',
  'ui-data',
  'server-client',
] as const;

interface DependencyCruiserRule {
  name: string;
}

interface EslintFamilyBlock {
  family: string;
  block: unknown;
}

interface DependencyCruiserFamily {
  family: string;
  forbidden: DependencyCruiserRule[];
}

export interface CollectedEnforcement {
  eslintSpecs: ForbiddenImportSpec[];
  eslintBlocks: EslintFamilyBlock[];
  depcruise: DependencyCruiserFamily[];
  boundaries: unknown | null;
  tsArchRules: BoundaryRule[];
  hasGraph: boolean;
  adopted: AdoptedRule[];
}

export interface CollectOptions {
  structural?: boolean;
  enforcers: InstalledEnforcers;
  only?: string;
  ruleIds?: readonly string[];
  mode?: ResolutionMode;
  allowed?: ReadonlyMap<string, readonly string[]>;
  appPath?: string;
}

const withIgnored = (ignored: readonly string[], extra: readonly string[]): string[] =>
  [...new Set([...ignored, ...extra])].sort();

const byName = (a: DependencyCruiserRule, b: DependencyCruiserRule): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

export function collectEnforcement(
  scan: ScanResult,
  options: CollectOptions,
): CollectedEnforcement {
  const structural = options.structural ?? false;
  const emitDepcruise = options.enforcers.dependencyCruiser;
  const emitEslint = options.enforcers.eslint || !options.enforcers.dependencyCruiser;
  const pick = (family: string): boolean => !options.only || options.only === family;
  const allowedFor = (ruleId: string): readonly string[] => options.allowed?.get(ruleId) ?? [];
  const appPath = options.appPath ?? '.';
  const allowing = <T extends { ignores?: string[] }>(block: T | null, ruleId: string): T | null =>
    block === null
      ? block
      : {
          ...block,
          ignores: withIgnored(
            [...(block.ignores ?? []), ...allowedFor(ruleId)].flatMap((entry) =>
              exemptionPaths(entry, appPath),
            ),
            [],
          ),
        };
  const idByName = new Map(
    scan.patterns.map((pattern) => [pattern.config.name, pattern.config.id]),
  );

  const eslintSpecs =
    emitEslint && pick('forbidden-imports')
      ? filterSpecs(buildForbiddenImportSpecs(scan.patterns), scan, options.ruleIds).map(
          (spec) => ({
            ...spec,
            ignore: withIgnored(spec.ignore, allowedFor(idByName.get(spec.name) ?? '')).map(
              (file) => exemptionPaths(file, appPath)[0]!,
            ),
          }),
        )
      : [];
  const adopted: AdoptedRule[] = scan.patterns
    .filter((pattern) => eslintSpecs.some((spec) => spec.name === pattern.config.name))
    .map((pattern) => forbiddenImportRule(pattern, options.mode ?? 'deep'));

  const eslintBlocks: EslintFamilyBlock[] = [];
  const pushBlock = (family: string, block: unknown | null): void => {
    if (block !== null) eslintBlocks.push({ family, block });
  };
  if (emitEslint && pick('console')) {
    const block = allowing(toEslintConsoleIsolation(scan.consoleIsolation), 'console-isolation');
    pushBlock('console', block);
    if (block !== null) adopted.push(consoleIsolationRule(scan));
  }
  if (structural && emitEslint && pick('env-access'))
    pushBlock('env-access', toEslintEnvAccess(scan.envAccess));
  const noRestricted: (NoRestrictedImportsBlock | null)[] = [];
  if (emitEslint && pick('import-style')) {
    const block = allowing(toEslintDeepRelative(scan.deepRelative), 'import-style');
    noRestricted.push(block);
    if (block !== null) adopted.push(importStyleRule(scan));
  }
  if (emitEslint && pick('test-isolation')) {
    const block = allowing(toEslintTestIsolation(scan.testIsolation), 'test-isolation');
    noRestricted.push(block);
    if (block !== null) adopted.push(testIsolationRule(scan));
  }
  if (structural && emitEslint && pick('workspace-package'))
    noRestricted.push(toEslintWorkspacePackageApi(scan.workspacePackageApi));
  mergeNoRestrictedImports(noRestricted).forEach((block, index) =>
    pushBlock(
      index === 0 ? 'no-restricted-imports' : `no-restricted-imports-exceptions-${index}`,
      block,
    ),
  );

  const depcruise: DependencyCruiserFamily[] = [];
  const pushDc = (family: string, forbidden: DependencyCruiserRule[]): void => {
    if (forbidden.length > 0) depcruise.push({ family, forbidden });
  };
  if (structural && emitDepcruise && pick('layer'))
    pushDc('layer', toDependencyCruiser(scan.layerBoundaries, ['AUTO']).forbidden);
  if (structural && emitDepcruise && pick('role-layering'))
    pushDc(
      'role-layering',
      toDependencyCruiserRoleLayering(scan.roleLayering.boundaries, ['AUTO']).forbidden,
    );
  if (emitDepcruise && pick('public-api')) {
    const forbidden = toDependencyCruiserPublicApi(scan.publicApi.groups, ['AUTO']).forbidden;
    pushDc('public-api', forbidden);
    if (forbidden.length > 0) adopted.push(...publicApiRules(scan));
  }
  if (structural && emitDepcruise && pick('feature-slice'))
    pushDc(
      'feature-slice',
      toDependencyCruiserFeatureSlice(scan.featureSlices.groups, ['AUTO']).forbidden,
    );
  if (structural && emitDepcruise && pick('app-isolation'))
    pushDc(
      'app-isolation',
      toDependencyCruiserAppIsolation(scan.appIsolation.groups, ['AUTO']).forbidden,
    );
  if (pick('test-isolation') && !emitEslint && emitDepcruise) {
    const forbidden = toDependencyCruiserTestIsolation(scan.testIsolation).forbidden;
    pushDc('test-isolation', forbidden);
    if (forbidden.length > 0) adopted.push(testIsolationRule(scan));
  }
  if (structural && emitDepcruise && pick('dependency-hygiene'))
    pushDc(
      'dependency-internals',
      toDependencyCruiserDependencyInternals(scan.dependencyInternals).forbidden,
    );
  if (structural && emitDepcruise && pick('entry-purity'))
    pushDc('entry-purity', toDependencyCruiserEntryPurity(scan.entryPurity).forbidden);
  if (structural && emitDepcruise && pick('phantom-deps'))
    pushDc(
      'phantom-deps',
      toDependencyCruiserPhantomDependencies(scan.phantomDependencies).forbidden,
    );
  if (structural && emitDepcruise && pick('stories-isolation'))
    pushDc(
      'stories-isolation',
      toDependencyCruiserStoriesIsolation(scan.storiesIsolation).forbidden,
    );
  if (structural && emitDepcruise && pick('ui-data'))
    pushDc('ui-data', toDependencyCruiserUiData(scan.uiDataIsolation).forbidden);
  if (structural && emitDepcruise && pick('server-client'))
    pushDc('server-client', toDependencyCruiserServerClient(scan.serverClient).forbidden);

  const bundles = options.only === undefined;
  const boundaries =
    structural && emitDepcruise && pick('layer')
      ? nonEmptyBoundaries(toEslintBoundaries(scan.layerBoundaries, ['AUTO']))
      : null;
  const tsArchRules: BoundaryRule[] = structural && bundles ? collectTsArchRules(scan) : [];

  return {
    eslintSpecs,
    eslintBlocks,
    depcruise,
    boundaries,
    tsArchRules,
    hasGraph: bundles && scan.layerBoundaries.length > 0,
    adopted,
  };
}

function filterSpecs(
  specs: ForbiddenImportSpec[],
  scan: ScanResult,
  ruleIds: readonly string[] | undefined,
): ForbiddenImportSpec[] {
  if (!ruleIds) return specs;
  const wantedIds = new Set(ruleIds.map((id) => id.toLowerCase()));
  const wantedNames = new Set(
    scan.patterns
      .filter((pattern) => wantedIds.has(pattern.config.id.toLowerCase()))
      .map((pattern) => pattern.config.name.toLowerCase()),
  );
  return specs.filter((spec) => wantedNames.has(spec.name.toLowerCase()));
}

function nonEmptyBoundaries(boundaries: unknown): unknown | null {
  const tuple = (
    boundaries as {
      rules?: { 'boundaries/element-types'?: [unknown, { rules?: unknown[] }] };
    }
  )?.rules?.['boundaries/element-types'];
  const inner = Array.isArray(tuple) ? tuple[1]?.rules : undefined;
  return Array.isArray(inner) && inner.length > 0 ? boundaries : null;
}

function collectTsArchRules(scan: ScanResult): BoundaryRule[] {
  return [
    ...toDependencyCruiser(scan.layerBoundaries, ['AUTO']).forbidden,
    ...toDependencyCruiserRoleLayering(scan.roleLayering.boundaries, ['AUTO']).forbidden,
    ...toDependencyCruiserUiData(scan.uiDataIsolation).forbidden,
  ];
}

const writeJson = (outDir: string, file: string, config: unknown): string => {
  writeOwnedFile(outDir, file, `${JSON.stringify(config, null, 2)}\n`);
  return file;
};

export function writeArchprintEslint(
  collected: CollectedEnforcement,
  outDir: string,
): string | null {
  if (collected.eslintSpecs.length === 0 && collected.eslintBlocks.length === 0) return null;
  const file = path.join(outDir, ESLINT_FILE);
  const blocks = collected.eslintBlocks.map((entry) => entry.block);
  writeOwnedFile(outDir, file, renderEslintPreset(collected.eslintSpecs, blocks));
  return file;
}

export function writeArchprintDepcruise(
  collected: CollectedEnforcement,
  outDir: string,
): string | null {
  const forbidden = collected.depcruise.flatMap((entry) => entry.forbidden).sort(byName);
  if (forbidden.length === 0) return null;
  return writeJson(outDir, path.join(outDir, DEPCRUISE_FILE), { forbidden });
}

function writeExpanded(
  collected: CollectedEnforcement,
  scan: ScanResult,
  outDir: string,
  graph: boolean,
): string[] {
  const written: string[] = [];
  if (collected.eslintSpecs.length > 0) {
    for (const spec of scan.patterns) {
      if (spec.result.gate.status !== 'AUTO') continue;
      if (!collected.eslintSpecs.some((s) => s.name === spec.config.name)) continue;
      written.push(
        emitRuleArtifacts(spec.config, spec.result, outDir, `archprint scan ${scan.appDir}`),
      );
    }
    written.push(
      writeFile(
        outDir,
        path.join(outDir, 'eslint-plugin.archprint.mjs'),
        renderEslintPluginSource(collected.eslintSpecs),
      ),
    );
  }
  for (const entry of collected.eslintBlocks) {
    written.push(
      writeJson(outDir, path.join(outDir, `eslint.${entry.family}.archprint.json`), entry.block),
    );
  }
  for (const entry of collected.depcruise) {
    written.push(
      writeJson(outDir, path.join(outDir, `dependency-cruiser.${entry.family}.archprint.json`), {
        forbidden: entry.forbidden,
      }),
    );
  }
  if (collected.boundaries !== null) {
    written.push(
      writeJson(
        outDir,
        path.join(outDir, 'eslint-boundaries.archprint.json'),
        collected.boundaries,
      ),
    );
  }
  if (collected.tsArchRules.length > 0) {
    written.push(
      writeFile(
        outDir,
        path.join(outDir, 'architecture.archprint.ts'),
        renderTsArchTests(collected.tsArchRules),
      ),
    );
  }
  if (graph && collected.hasGraph) {
    written.push(
      writeFile(
        outDir,
        path.join(outDir, 'layer-graph.archprint.mmd'),
        `${toMermaid(scan.layerBoundaries)}\n`,
      ),
    );
    written.push(
      writeFile(
        outDir,
        path.join(outDir, 'layer-graph.archprint.dot'),
        `${toGraphviz(scan.layerBoundaries)}\n`,
      ),
    );
  }
  return written;
}

const writeFile = (outDir: string, file: string, content: string): string => {
  writeOwnedFile(outDir, file, content);
  return file;
};

export interface EmitResult {
  eslint: string | null;
  depcruise: string | null;
  rules: string;
  expanded: string[];
}

export function emitLayout(
  scan: ScanResult,
  outDir: string,
  options: CollectOptions & { expand?: boolean; graph?: boolean; version: string },
): EmitResult {
  const collected = collectEnforcement(scan, {
    ...options,
    allowed: allowedFilesByRule(readAllowed(outDir)),
  });
  const eslint = writeArchprintEslint(collected, outDir);
  const depcruise = writeArchprintDepcruise(collected, outDir);
  const rules = writeAdoptedRules(outDir, collected.adopted, options.version);
  const expanded = options.expand
    ? writeExpanded(collected, scan, outDir, options.graph !== false)
    : [];
  return { eslint, depcruise, rules, expanded };
}

export function emitOne(pattern: ScannedPattern, appDir: string, outDir: string): string {
  return emitRuleArtifacts(pattern.config, pattern.result, outDir, `archprint scan ${appDir}`);
}
