import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { checkSelfConsistency } from '../detector/self-consistency.js';
import { discoverAppDirs } from '../scanner/app-dirs.js';
import { hasTsConfig, scanRepo, type ScanResult, type ScannedPattern } from './scan.js';
import { renderExplain, renderInit, renderReport, renderRecommendations } from './report.js';
import { buildRecommendations, detectStack } from './recommend.js';
import { emitOne, writeEnforcementConfigs } from './generate.js';
import { buildInitManifest, INIT_MANIFEST_FILE, writeInitManifest } from './init.js';

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
    .command('init')
    .description(
      'Set up archprint for this repo: detect the stack, enforce the rules your code already follows, and record what to adopt next',
    )
    .argument('[path]', 'app directory', '.')
    .option('-o, --out <dir>', 'output directory for rule configs', 'archprint-rules')
    .option('--fast', 'skip barrel/alias resolution (faster, less accurate)')
    .option(
      '--include-structural',
      'also enforce the structural-inference families (held for review by default)',
    )
    .option('--force', `overwrite an existing ${INIT_MANIFEST_FILE} and rule configs`)
    .action(
      (
        input: string,
        options: { out: string; fast?: boolean; includeStructural?: boolean; force?: boolean },
      ) => {
        const appDir = resolveApp(input);
        const manifestPath = path.resolve(INIT_MANIFEST_FILE);
        if (existsSync(manifestPath) && !options.force) {
          console.error(
            `${INIT_MANIFEST_FILE} already exists. Re-run with --force to overwrite, or use 'archprint scan' / 'archprint generate' directly.`,
          );
          process.exitCode = 1;
          return;
        }
        const scan = scanRepo(appDir, { deep: !options.fast });
        const issues = checkSelfConsistency(scan);
        /* v8 ignore start -- defensive guardrail: fires only if a detector regresses into inconsistency */
        if (issues.length > 0) {
          console.error(
            'Refusing to init: a rule failed the self-consistency check (its evidence does not match what it would enforce):',
          );
          for (const issue of issues) console.error(`  - ${issue.rule}: ${issue.problem}`);
          process.exitCode = 1;
          return;
        }
        /* v8 ignore stop */
        const outDir = path.resolve(options.out);
        const structural = options.includeStructural ?? false;
        const configs = writeEnforcementConfigs(scan, outDir, { structural });
        const writtenCount = configs.reduce((n, config) => n + config.files.length, 0);
        const recommendations = buildRecommendations(scan, detectStack(appDir));
        const cwd = process.cwd();
        const relOrAbs = (target: string): string => {
          const rel = path.relative(cwd, target);
          return rel === '' ? '.' : rel.startsWith('..') ? target : rel;
        };
        const manifest = buildInitManifest(recommendations, version, {
          app: relOrAbs(appDir),
          rulesDir: relOrAbs(outDir),
        });
        writeInitManifest(manifest, manifestPath);
        console.log(renderInit(manifest, writtenCount, structural, version));
        if (options.fast) {
          console.log(
            '\nWarning: rules came from a fast specifier-level scan; re-run without --fast before enforcing.',
          );
        }
      },
    );

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
        const configs = writeEnforcementConfigs(scan, outDir, { structural });
        if (configs.length === 0) {
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
        for (const config of configs) {
          for (const file of config.files) report(file, config.label === null ? '/' : '');
          if (config.label !== null) console.log(`  (${config.label})`);
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
      const { appDir, pattern } = findPattern(input, id, Boolean(options.deep));
      console.log(renderExplain(pattern, appDir));
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
