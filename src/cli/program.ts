import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { checkSelfConsistency } from '../detector/self-consistency.js';
import { discoverAppDirs } from '../scanner/app-dirs.js';
import { hasTsConfig, scanRepo, type ScanResult, type ScannedPattern } from './scan.js';
import { renderExplain, renderReport, renderRecommendations } from './report.js';
import { buildRecommendations, detectStack } from './recommend.js';
import {
  emitOne,
  writeAppIsolationConfig,
  writeConsoleIsolationConfig,
  writeDeepRelativeConfig,
  writeDependencyInternalsConfig,
  writeEnvAccessConfig,
  writeEntryPurityConfig,
  writeFeatureSliceConfig,
  writeGraph,
  writeLayerConfig,
  writePhantomDependencyConfig,
  writePublicApiConfig,
  writeRoleLayeringConfig,
  writeRules,
  writeServerClientConfig,
  writeStoriesIsolationConfig,
  writeTestIsolationConfig,
  writeUiDataConfig,
  writeWorkspacePackageConfig,
} from './generate.js';

export function readVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return (
    JSON.parse(readFileSync(path.join(here, '..', '..', 'package.json'), 'utf8')) as {
      version: string;
    }
  ).version;
}

function countStructuralAuto(scan: ScanResult): number {
  const groups = [
    scan.layerBoundaries,
    scan.roleLayering.boundaries,
    scan.featureSlices.groups,
    scan.appIsolation.groups,
  ];
  const singles = [
    scan.entryPurity,
    scan.envAccess,
    scan.workspacePackageApi,
    scan.storiesIsolation,
    scan.uiDataIsolation,
    scan.serverClient,
  ];
  return (
    groups.reduce((n, g) => n + g.filter((x) => x.gate.status === 'AUTO').length, 0) +
    singles.filter((s) => s.gate.status === 'AUTO').length
  );
}

function resolveApp(input: string): string {
  const appDir = path.resolve(input);
  if (!hasTsConfig(appDir)) {
    throw new Error(
      `No tsconfig.json in ${appDir}. Point archprint at an app directory (for a monorepo, e.g. apps/web).`,
    );
  }
  return appDir;
}

function findPattern(
  input: string,
  id: string,
  deep: boolean,
): { appDir: string; pattern: ScannedPattern } {
  const appDir = resolveApp(input);
  const pattern = scanRepo(appDir, { deep }).patterns.find(
    (candidate) => candidate.config.id.toLowerCase() === id.toLowerCase(),
  );
  if (!pattern) throw new Error(`No pattern "${id}" found in ${appDir}.`);
  return { appDir, pattern };
}

export function buildProgram(version = readVersion()): Command {
  const program = new Command();
  program
    .name('archprint')
    .description(
      'Mine the architecture rules your repo already enforces, with the evidence attached.',
    )
    .version(version)
    .exitOverride();

  program
    .command('scan')
    .description('Scan an app and report the rules it already follows')
    .argument('[path]', 'app directory (contains tsconfig.json)', '.')
    .option('--deep', 'resolve imports through barrels/aliases (slower, more accurate)')
    .action((input: string, options: { deep?: boolean }) => {
      const root = path.resolve(input);
      const appDirs = discoverAppDirs(root);
      if (appDirs.length === 0) {
        throw new Error(
          `No tsconfig.json found under ${root}. Point archprint at an app directory (a directory with a tsconfig.json); a monorepo root is fine.`,
        );
      }
      const started = performance.now();
      const reports = appDirs.map((appDir) => {
        const scan = scanRepo(appDir, { deep: options.deep });
        const label = appDirs.length > 1 ? `### ${path.relative(root, appDir) || '.'}\n` : '';
        return label + renderReport(scan, version, undefined, options.deep);
      });
      console.log(reports.join('\n\n'));
      if (appDirs.length > 1) {
        const elapsed = ((performance.now() - started) / 1000).toFixed(1);
        console.log(`\nScanned ${appDirs.length} app directories in ${elapsed}s.`);
      }
    });

  program
    .command('generate')
    .description(
      'Write the four rule artifacts for every AUTO pattern (resolves the graph by default)',
    )
    .argument('[path]', 'app directory', '.')
    .option('-o, --out <dir>', 'output directory', 'archprint-rules')
    .option(
      '--fast',
      'skip barrel/alias resolution (faster, may mint a rule the full graph rejects)',
    )
    .option(
      '--include-structural',
      'also emit the structural-inference families (layer, role, entry-purity, ui/data, server/client, feature-slice, app-isolation, stories, env, workspace-package) as AUTO. Held for review by default: the Phase A audit found their inferred layers/roles can be wrong; review before enforcing.',
    )
    .action(
      (input: string, options: { out: string; fast?: boolean; includeStructural?: boolean }) => {
        const scan = scanRepo(resolveApp(input), { deep: !options.fast });
        const issues = checkSelfConsistency(scan);
        /* v8 ignore start -- defensive guardrail: fires only if a detector regresses into inconsistency */
        if (issues.length > 0) {
          console.error(
            'Refusing to generate: a rule failed the self-consistency check (its evidence does not match what it would enforce):',
          );
          for (const issue of issues) console.error(`  - ${issue.rule}: ${issue.problem}`);
          process.exitCode = 1;
          return;
        }
        /* v8 ignore stop */
        const outDir = path.resolve(options.out);
        const structural = options.includeStructural ?? false;
        const heldStructuralAuto = structural ? 0 : countStructuralAuto(scan);
        const written = writeRules(scan, outDir, ['AUTO']);
        const layerFiles = structural ? writeLayerConfig(scan, outDir, ['AUTO']) : [];
        const roleFiles = structural ? writeRoleLayeringConfig(scan, outDir, ['AUTO']) : [];
        const apiFiles = writePublicApiConfig(scan, outDir, ['AUTO']);
        const sliceFiles = structural ? writeFeatureSliceConfig(scan, outDir, ['AUTO']) : [];
        const appFiles = structural ? writeAppIsolationConfig(scan, outDir, ['AUTO']) : [];
        const testIsoFiles = writeTestIsolationConfig(scan, outDir);
        const depFiles = writeDependencyInternalsConfig(scan, outDir);
        const entryFiles = structural ? writeEntryPurityConfig(scan, outDir) : [];
        const phantomFiles = writePhantomDependencyConfig(scan, outDir);
        const deepRelFiles = writeDeepRelativeConfig(scan, outDir);
        const consoleFiles = writeConsoleIsolationConfig(scan, outDir);
        const envFiles = structural ? writeEnvAccessConfig(scan, outDir) : [];
        const wpkgFiles = structural ? writeWorkspacePackageConfig(scan, outDir) : [];
        const storiesFiles = structural ? writeStoriesIsolationConfig(scan, outDir) : [];
        const uiDataFiles = structural ? writeUiDataConfig(scan, outDir) : [];
        const serverClientFiles = structural ? writeServerClientConfig(scan, outDir) : [];
        const graphFiles = writeGraph(scan, outDir);
        if (
          written.length === 0 &&
          layerFiles.length === 0 &&
          roleFiles.length === 0 &&
          apiFiles.length === 0 &&
          sliceFiles.length === 0 &&
          appFiles.length === 0 &&
          testIsoFiles.length === 0 &&
          depFiles.length === 0 &&
          entryFiles.length === 0 &&
          phantomFiles.length === 0 &&
          deepRelFiles.length === 0 &&
          consoleFiles.length === 0 &&
          envFiles.length === 0 &&
          wpkgFiles.length === 0 &&
          storiesFiles.length === 0 &&
          uiDataFiles.length === 0 &&
          serverClientFiles.length === 0 &&
          graphFiles.length === 0
        ) {
          if (heldStructuralAuto > 0) {
            console.log(
              `No mechanical AUTO rules to generate. ${heldStructuralAuto} structural rule(s) are held for review; pass --include-structural to emit them (review before enforcing).`,
            );
          } else {
            console.log('No AUTO rules to generate.');
          }
          return;
        }
        const report = (target: string, suffix = ''): void => {
          const relative = path.relative(process.cwd(), target);
          console.log(`generated ${relative.startsWith('..') ? target : relative}${suffix}`);
        };
        for (const dir of written) report(dir, '/');
        for (const file of layerFiles) report(file);
        if (layerFiles.length > 0) {
          const count = scan.layerBoundaries.filter(
            (boundary) => boundary.gate.status === 'AUTO',
          ).length;
          console.log(
            `  (${count} layer boundaries: dependency-cruiser and eslint-plugin-boundaries)`,
          );
        }
        for (const file of roleFiles) report(file);
        if (roleFiles.length > 0) {
          const count = scan.roleLayering.boundaries.filter((b) => b.gate.status === 'AUTO').length;
          console.log(`  (${count} role-layering boundaries: dependency-cruiser rules)`);
        }
        for (const file of apiFiles) report(file);
        if (apiFiles.length > 0) {
          const count = scan.publicApi.groups.filter(
            (group) => group.gate.status === 'AUTO',
          ).length;
          console.log(`  (${count} public API boundaries: dependency-cruiser deep-import rules)`);
        }
        for (const file of sliceFiles) report(file);
        if (sliceFiles.length > 0) {
          const count = scan.featureSlices.groups.filter(
            (group) => group.gate.status === 'AUTO',
          ).length;
          console.log(
            `  (${count} feature-slice boundaries: dependency-cruiser cross-slice rules)`,
          );
        }
        for (const file of appFiles) report(file);
        if (appFiles.length > 0) {
          const count = scan.appIsolation.groups.filter(
            (group) => group.gate.status === 'AUTO',
          ).length;
          console.log(`  (${count} app boundaries: dependency-cruiser cross-app rules)`);
        }
        for (const file of testIsoFiles) report(file);
        if (testIsoFiles.length > 0) {
          console.log('  (test isolation: dependency-cruiser not-to-test rule)');
        }
        for (const file of depFiles) report(file);
        if (depFiles.length > 0) {
          console.log('  (dependency hygiene: dependency-cruiser no-internals rule)');
        }
        for (const file of entryFiles) report(file);
        if (entryFiles.length > 0) {
          console.log('  (entry purity: dependency-cruiser no-import-entry rule)');
        }
        for (const file of phantomFiles) report(file);
        if (phantomFiles.length > 0) {
          console.log('  (dependency declaration: dependency-cruiser no-phantom-deps rule)');
        }
        for (const file of deepRelFiles) report(file);
        if (deepRelFiles.length > 0) {
          console.log('  (import style: eslint no-restricted-imports rule)');
        }
        for (const file of consoleFiles) report(file);
        if (consoleFiles.length > 0) {
          console.log('  (console isolation: eslint no-console rule)');
        }
        for (const file of envFiles) report(file);
        if (envFiles.length > 0) {
          console.log('  (env access: eslint no-restricted-properties rule)');
        }
        for (const file of wpkgFiles) report(file);
        if (wpkgFiles.length > 0) {
          console.log('  (workspace package API: eslint no-restricted-imports rule)');
        }
        for (const file of storiesFiles) report(file);
        if (storiesFiles.length > 0) {
          console.log('  (stories isolation: dependency-cruiser no-import-stories rule)');
        }
        for (const file of uiDataFiles) report(file);
        if (uiDataFiles.length > 0) {
          console.log('  (UI / data separation: dependency-cruiser no-ui-to-data rule)');
        }
        for (const file of serverClientFiles) report(file);
        if (serverClientFiles.length > 0) {
          console.log(
            '  (server / client boundary: dependency-cruiser no-server-only-in-client rule)',
          );
        }
        for (const file of graphFiles) report(file);
        if (graphFiles.length > 0) {
          console.log('  (layer dependency graph: Mermaid and Graphviz DOT)');
        }
        if (heldStructuralAuto > 0) {
          console.log(
            `Held ${heldStructuralAuto} structural rule(s) for review (layer / role / entry-purity / ui-data / server-client / ...): their inferred layers/roles can be wrong. Review with 'archprint scan', then pass --include-structural to emit them.`,
          );
        }
        if (options.fast) {
          console.log(
            'Warning: generated from a fast specifier-level scan; re-run without --fast to confirm no barrel/alias-hidden violations before enforcing.',
          );
        }
      },
    );

  program
    .command('recommend')
    .description('Recommend a rule set for this repo (or a fresh one) from its stack and evidence')
    .argument('[path]', 'app directory', '.')
    .action((input: string) => {
      const appDir = resolveApp(input);
      const scan = scanRepo(appDir, { deep: false });
      const recommendations = buildRecommendations(scan, detectStack(appDir));
      console.log(renderRecommendations(recommendations, version));
    });

  program
    .command('explain')
    .description('Show the gate evidence behind a rule id')
    .argument('<id>', 'rule id, e.g. AP-002')
    .argument('[path]', 'app directory', '.')
    .option('--deep', 'resolve imports through barrels/aliases (slower, more accurate)')
    .action((id: string, input: string, options: { deep?: boolean }) => {
      console.log(renderExplain(findPattern(input, id, Boolean(options.deep)).pattern));
    });

  program
    .command('approve')
    .description(
      'Generate a SUGGEST rule after reviewing its evidence (resolves the graph by default)',
    )
    .argument('<id>', 'rule id, e.g. AP-001')
    .argument('[path]', 'app directory', '.')
    .option('-o, --out <dir>', 'output directory', 'archprint-rules')
    .option('--fast', 'skip barrel/alias resolution (faster, less accurate)')
    .action((id: string, input: string, options: { out: string; fast?: boolean }) => {
      const { appDir, pattern } = findPattern(input, id, !options.fast);
      const dir = emitOne(pattern, appDir, path.resolve(options.out));
      console.log(`generated ${path.relative(process.cwd(), dir)}/`);
      if (options.fast) {
        console.log(
          'Warning: approved from a fast specifier-level scan; re-run without --fast to confirm no barrel/alias-hidden violations before enforcing.',
        );
      }
    });

  return program;
}
