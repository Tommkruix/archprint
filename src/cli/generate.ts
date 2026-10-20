import * as path from 'node:path';
import { exemptionGlobs, literalGlob, repoPath } from '../generator/eslint-scope.js';
import { writeOwnedFile } from '../generator/owned-paths.js';
import {
  layerRuleName,
  toDependencyCruiser,
  toEslintBoundaries,
} from '../generator/layer-emitters.js';
import {
  type EslintAppRules,
  hasAppRules,
  layerRuleSpecs,
  phantomRuleSpec,
  renderEslintAppRules,
  serverClientRuleSpec,
} from '../generator/eslint-app-emitter.js';
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
import {
  PHANTOM_DEPENDENCY_RULE,
  toDependencyCruiserPhantomDependencies,
} from '../generator/phantom-dependency-emitters.js';
import type { InstalledEnforcers } from '../scanner/enforcers.js';
import { toEslintDeepRelative } from '../generator/deep-relative-emitters.js';
import { toEslintConsoleIsolation } from '../generator/console-isolation-emitters.js';
import { toEslintEnvAccess } from '../generator/env-access-emitters.js';
import { toEslintWorkspacePackageApi } from '../generator/workspace-package-emitters.js';
import { toDependencyCruiserStoriesIsolation } from '../generator/stories-isolation-emitters.js';
import { toDependencyCruiserUiData } from '../generator/ui-data-isolation-emitters.js';
import {
  SERVER_CLIENT_RULE,
  toDependencyCruiserServerClient,
} from '../generator/server-client-emitters.js';
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
import type { LayerBoundary } from '../detector/layer-detector.js';
import type { ScannedPattern, ScanResult } from './scan.js';
import {
  consoleIsolationRule,
  forbiddenImportRule,
  importStyleRule,
  cycleRule,
  isCycleFree,
  layerRule,
  NO_CYCLES_RULE,
  phantomDependencyRule,
  serverClientRule,
  publicApiRules,
  byRuleId,
  testIsolationRule,
  type AdoptedRule,
  type ResolutionMode,
} from './adopted-rules.js';

export const ESLINT_FILE = 'eslint.mjs';
export const DEPCRUISE_FILE = 'dependency-cruiser.json';
export const ARCHPRINT_DIR = '.archprint';

export const FAMILY_NAMES = [
  'forbidden-imports',
  'cycles',
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
  eslintApp: EslintAppRules | null;
  eslintBlocks: EslintFamilyBlock[];
  depcruise: DependencyCruiserFamily[];
  boundaries: unknown | null;
  tsArchRules: BoundaryRule[];
  hasGraph: boolean;
  adopted: AdoptedRule[];
  /** The rule ids this run could emit, and the --rules entries that named none of them. */
  availableRules: string[];
  unknownRules: string[];
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

const selectorKey = (selector: string): string =>
  selector.trim().replace(/\s+/g, ' ').toLowerCase();

/** Which emitted rules --rules keeps: every rule when it is absent, else those named by id or label. */
class RuleSelection {
  private readonly wanted: ReadonlyMap<string, string> | null;
  private readonly seen = new Set<string>();
  private readonly ids = new Set<string>();

  constructor(ruleIds: readonly string[] | undefined) {
    this.wanted =
      ruleIds === undefined ? null : new Map(ruleIds.map((id) => [selectorKey(id), id.trim()]));
  }

  selects(id: string, label?: string): boolean {
    const keys = [id, label].filter((key): key is string => key !== undefined).map(selectorKey);
    this.ids.add(id);
    for (const key of keys) this.seen.add(key);
    return this.wanted === null || keys.some((key) => this.wanted!.has(key));
  }

  keeps(id: string): boolean {
    return this.wanted === null || this.wanted.has(selectorKey(id));
  }

  available(): string[] {
    return [...this.ids].sort();
  }

  unknown(): string[] {
    return [...(this.wanted ?? [])]
      .filter(([key]) => !this.seen.has(key))
      .map(([, original]) => original);
  }
}

/** Layer boundaries whose rule name is theirs alone: `no-a-to-b-to-c` can name two boundaries. */
const uniquelyNamed = (boundaries: readonly LayerBoundary[]): LayerBoundary[] => {
  const names = boundaries.map(layerRuleName);
  return boundaries.filter(
    (_, index) => names.indexOf(names[index]!) === names.lastIndexOf(names[index]!),
  );
};

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
            [...(block.ignores ?? []), ...allowedFor(ruleId).map(literalGlob)].flatMap((glob) =>
              exemptionGlobs(glob, appPath),
            ),
            [],
          ),
        };
  const idByName = new Map(
    scan.patterns.map((pattern) => [pattern.config.name, pattern.config.id]),
  );

  const selection = new RuleSelection(options.ruleIds);
  const selects = (id: string, label?: string): boolean => selection.selects(id, label);
  const selected = <T extends { name: string }>(rules: readonly T[]): T[] =>
    rules.filter((rule) => selects(rule.name));

  const eslintSpecs =
    emitEslint && pick('forbidden-imports')
      ? buildForbiddenImportSpecs(scan.patterns)
          .filter((spec) => selects(idByName.get(spec.name) ?? spec.name, spec.name))
          .map((spec) => ({
            ...spec,
            ignore: withIgnored(spec.ignore, allowedFor(idByName.get(spec.name) ?? '')).map(
              (file) => repoPath(file, appPath),
            ),
          }))
      : [];
  const adopted: AdoptedRule[] = scan.patterns
    .filter((pattern) => eslintSpecs.some((spec) => spec.name === pattern.config.name))
    .map((pattern) => forbiddenImportRule(pattern, options.mode ?? 'deep'));

  const eslintBlocks: EslintFamilyBlock[] = [];
  const pushBlock = (family: string, block: unknown | null): void => {
    if (block !== null) eslintBlocks.push({ family, block });
  };
  const chosen = <T>(id: string, output: T | null): T | null =>
    output !== null && selects(id) ? output : null;
  if (emitEslint && pick('console')) {
    const block = chosen(
      'console-isolation',
      allowing(toEslintConsoleIsolation(scan.consoleIsolation), 'console-isolation'),
    );
    pushBlock('console', block);
    if (block !== null) adopted.push(consoleIsolationRule(scan));
  }
  if (structural && emitEslint && pick('env-access'))
    pushBlock(
      'env-access',
      chosen('env-access', allowing(toEslintEnvAccess(scan.envAccess), 'env-access')),
    );
  const noRestricted: (NoRestrictedImportsBlock | null)[] = [];
  if (emitEslint && pick('import-style')) {
    const block = chosen(
      'import-style',
      allowing(toEslintDeepRelative(scan.deepRelative), 'import-style'),
    );
    noRestricted.push(block);
    if (block !== null) adopted.push(importStyleRule(scan));
  }
  if (emitEslint && pick('test-isolation')) {
    const block = chosen(
      'test-isolation',
      allowing(toEslintTestIsolation(scan.testIsolation), 'test-isolation'),
    );
    noRestricted.push(block);
    if (block !== null) adopted.push(testIsolationRule(scan));
  }
  if (structural && emitEslint && pick('workspace-package'))
    noRestricted.push(
      chosen(
        'workspace-package',
        allowing(toEslintWorkspacePackageApi(scan.workspacePackageApi), 'workspace-package'),
      ),
    );
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
  const pushNamedDc = (family: string, forbidden: DependencyCruiserRule[]): void =>
    pushDc(family, selected(forbidden));
  const layers =
    structural && pick('layer')
      ? uniquelyNamed(scan.layerBoundaries.filter((b) => b.gate.status === 'AUTO')).filter(
          (boundary) => selects(layerRuleName(boundary), `${boundary.from} !-> ${boundary.to}`),
        )
      : [];
  const isEnforceable = (gate: { status: string }, population: number): boolean =>
    gate.status === 'AUTO' && population > 0;
  const phantom =
    structural &&
    pick('phantom-deps') &&
    isEnforceable(scan.phantomDependencies.gate, scan.phantomDependencies.externalImporterCount) &&
    selects(PHANTOM_DEPENDENCY_RULE)
      ? scan.phantomDependencies
      : null;
  const serverClient =
    structural &&
    pick('server-client') &&
    isEnforceable(scan.serverClient.gate, scan.serverClient.clientCount) &&
    selects(SERVER_CLIENT_RULE)
      ? scan.serverClient
      : null;
  const appRules: EslintAppRules = {
    appDir: scan.appDir,
    aliases: scan.layerAliases,
    ignored: scan.gitignoredPaths,
    layers: layerRuleSpecs(layers, allowedFor),
    phantom:
      phantom === null
        ? null
        : phantomRuleSpec(
            phantom,
            phantom.declaringPackageJsons,
            phantom.workspacePackages,
            allowedFor,
          ),
    serverClient: serverClient === null ? null : serverClientRuleSpec(serverClient, allowedFor),
  };
  const eslintApp = emitDepcruise || !hasAppRules(appRules) ? null : appRules;
  if (emitDepcruise) {
    pushDc('layer', toDependencyCruiser(layers, ['AUTO'], appPath, allowedFor).forbidden);
    if (phantom !== null)
      pushDc('phantom-deps', toDependencyCruiserPhantomDependencies(phantom, allowedFor).forbidden);
    if (serverClient !== null)
      pushDc(
        'server-client',
        toDependencyCruiserServerClient(serverClient, appPath, allowedFor).forbidden,
      );
  }
  adopted.push(...layers.map(layerRule));
  if (phantom !== null) adopted.push(phantomDependencyRule(scan));
  if (pick('cycles') && isCycleFree(scan) && selects(NO_CYCLES_RULE)) adopted.push(cycleRule(scan));
  if (serverClient !== null) adopted.push(serverClientRule(scan));
  if (structural && emitDepcruise && pick('role-layering'))
    pushNamedDc(
      'role-layering',
      toDependencyCruiserRoleLayering(scan.roleLayering.boundaries, ['AUTO']).forbidden,
    );
  if (emitDepcruise && pick('public-api')) {
    const forbidden = toDependencyCruiserPublicApi(scan.publicApi.groups, ['AUTO']).forbidden;
    pushNamedDc('public-api', forbidden);
    adopted.push(...publicApiRules(scan).filter((rule) => selects(rule.id)));
  }
  if (structural && emitDepcruise && pick('feature-slice'))
    pushNamedDc(
      'feature-slice',
      toDependencyCruiserFeatureSlice(scan.featureSlices.groups, ['AUTO']).forbidden,
    );
  if (structural && emitDepcruise && pick('app-isolation'))
    pushNamedDc(
      'app-isolation',
      toDependencyCruiserAppIsolation(scan.appIsolation.groups, ['AUTO']).forbidden,
    );
  if (pick('test-isolation') && !emitEslint && emitDepcruise) {
    const forbidden = toDependencyCruiserTestIsolation(scan.testIsolation).forbidden;
    if (forbidden.length > 0 && selects('test-isolation')) {
      pushDc('test-isolation', forbidden);
      adopted.push(testIsolationRule(scan));
    }
  }
  if (structural && emitDepcruise && pick('dependency-hygiene'))
    pushNamedDc(
      'dependency-internals',
      toDependencyCruiserDependencyInternals(scan.dependencyInternals).forbidden,
    );
  if (structural && emitDepcruise && pick('entry-purity'))
    pushNamedDc('entry-purity', toDependencyCruiserEntryPurity(scan.entryPurity).forbidden);
  if (structural && emitDepcruise && pick('stories-isolation'))
    pushNamedDc(
      'stories-isolation',
      toDependencyCruiserStoriesIsolation(scan.storiesIsolation).forbidden,
    );
  if (structural && emitDepcruise && pick('ui-data'))
    pushNamedDc('ui-data', toDependencyCruiserUiData(scan.uiDataIsolation).forbidden);

  const bundles = options.only === undefined;
  const boundaries = emitDepcruise
    ? nonEmptyBoundaries(toEslintBoundaries(layers, ['AUTO']))
    : null;
  const tsArchRules: BoundaryRule[] =
    structural && bundles
      ? collectTsArchRules(scan, layers, (rule) => selection.keeps(rule.name))
      : [];

  return {
    eslintSpecs,
    eslintApp,
    eslintBlocks,
    depcruise,
    boundaries,
    tsArchRules,
    hasGraph: bundles && scan.layerBoundaries.length > 0,
    adopted,
    availableRules: selection.available(),
    unknownRules: selection.unknown(),
  };
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

function collectTsArchRules(
  scan: ScanResult,
  layers: readonly LayerBoundary[],
  keeps: (rule: BoundaryRule) => boolean,
): BoundaryRule[] {
  return [
    ...toDependencyCruiser(layers, ['AUTO']).forbidden,
    ...[
      ...toDependencyCruiserRoleLayering(scan.roleLayering.boundaries, ['AUTO']).forbidden,
      ...toDependencyCruiserUiData(scan.uiDataIsolation).forbidden,
    ].filter(keeps),
  ];
}

const writeJson = (outDir: string, file: string, config: unknown): string => {
  writeOwnedFile(outDir, file, `${JSON.stringify(config, null, 2)}\n`);
  return file;
};

export const writesEslint = ({
  eslintSpecs,
  eslintBlocks,
  eslintApp,
}: CollectedEnforcement): boolean =>
  eslintSpecs.length > 0 || eslintBlocks.length > 0 || eslintApp !== null;

export function writeArchprintEslint(
  collected: CollectedEnforcement,
  outDir: string,
): string | null {
  if (!writesEslint(collected)) return null;
  const { eslintSpecs, eslintBlocks, eslintApp } = collected;
  const file = path.join(outDir, ESLINT_FILE);
  const blocks = eslintBlocks.map((entry) => entry.block);
  const app = eslintApp === null ? undefined : renderEslintAppRules(eslintApp, outDir);
  writeOwnedFile(outDir, file, renderEslintPreset(eslintSpecs, blocks, { app }));
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
  rules: AdoptedRule[];
  expanded: string[];
}

export function emitLayout(
  scan: ScanResult,
  outDir: string,
  options: CollectOptions & { expand?: boolean; graph?: boolean; version: string },
): EmitResult {
  const collected = collectEnforcement(scan, options);
  const eslint = writeArchprintEslint(collected, outDir);
  const depcruise = writeArchprintDepcruise(collected, outDir);
  const rules = [...collected.adopted].sort(byRuleId);
  const expanded = options.expand
    ? writeExpanded(collected, scan, outDir, options.graph !== false)
    : [];
  return { eslint, depcruise, rules, expanded };
}

export function emitOne(pattern: ScannedPattern, appDir: string, outDir: string): string {
  return emitRuleArtifacts(pattern.config, pattern.result, outDir, `archprint scan ${appDir}`);
}
