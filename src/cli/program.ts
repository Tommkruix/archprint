import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { checkSelfConsistency } from '../detector/self-consistency.js';
import { discoverAppDirs } from '../scanner/app-dirs.js';
import { hasTsConfig, scanRepo, type ScanResult, type ScannedPattern } from './scan.js';
import { renderExplain, renderInit, renderReport, renderRecommendations } from './report.js';
import { buildRecommendations, detectStack } from './recommend.js';
import { toScanSummary } from './summary.js';
import { emitOne, regenerateConfigs } from './generate.js';
import { buildInitManifest, INIT_MANIFEST_FILE, writeInitManifest } from './init.js';
import { OUTPUTS_MANIFEST_FILE, readOutputs, removeIfEmpty } from './outputs-manifest.js';
import { WIRING_TOOLS } from './wiring.js';

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

function displayPath(target: string, cwd: string = process.cwd()): string {
  const relative = path.relative(cwd, target);
  return relative === '' ? '.' : relative.startsWith('..') ? target : relative;
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
        const { configs } = regenerateConfigs(scan, outDir, { structural, version });
        const writtenCount = configs.reduce((n, config) => n + config.files.length, 0);
        const recommendations = buildRecommendations(scan, detectStack(appDir));
        const cwd = process.cwd();
        const manifest = buildInitManifest(recommendations, version, {
          app: displayPath(appDir, cwd),
          rulesDir: displayPath(outDir, cwd),
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
    .option('--json', 'emit a machine-readable JSON summary instead of the human report')
    .action((input: string, options: { deep?: boolean; json?: boolean }) => {
      const root = path.resolve(input);
      const appDirs = discoverAppDirs(root);
      if (appDirs.length === 0) {
        throw new Error(
          `No tsconfig.json found under ${root}. Point archprint at an app directory (a directory with a tsconfig.json); a monorepo root is fine.`,
        );
      }
      if (options.json) {
        const apps = appDirs.map((appDir) => ({
          app: displayPath(appDir, root),
          ...toScanSummary(scanRepo(appDir, { deep: options.deep })),
        }));
        console.log(JSON.stringify({ archprintVersion: version, apps }, null, 2));
        return;
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
        const { configs, removed } = regenerateConfigs(scan, outDir, { structural, version });
        if (removed.length > 0) {
          console.log(
            `Refreshed: removed ${removed.length} stale archprint output(s) before writing.`,
          );
        }
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
    .option('--json', 'emit a machine-readable JSON summary instead of the human report')
    .action((input: string, options: { json?: boolean }) => {
      const appDir = resolveApp(input);
      const scan = scanRepo(appDir, { deep: false });
      const recommendations = buildRecommendations(scan, detectStack(appDir));
      if (options.json) {
        console.log(JSON.stringify({ archprintVersion: version, ...recommendations }, null, 2));
        return;
      }
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

  program
    .command('wire')
    .description(
      "Reference archprint's generated rules from the enforcement tools your repo uses (managed, reversible)",
    )
    .option(
      '-o, --out <dir>',
      'output directory that holds the generated rule configs',
      'archprint-rules',
    )
    .option('--dry-run', 'show what would change without writing')
    .action((options: { out: string; dryRun?: boolean }) => {
      const cwd = process.cwd();
      const outDir = path.resolve(options.out);
      const active = WIRING_TOOLS.filter((tool) => tool.hasOutputs(outDir));
      if (active.length === 0) {
        console.error(
          `No generated rules in ${displayPath(outDir)}. Run 'archprint generate' (or 'archprint init') first.`,
        );
        process.exitCode = 1;
        return;
      }
      for (const tool of active) {
        const aggregate = tool.aggregatePath(outDir);
        const configPath = tool.findConfig(cwd);
        if (!configPath || !tool.canEdit(configPath)) {
          const reference = tool.reference(configPath ? path.dirname(configPath) : cwd, aggregate);
          const where = configPath
            ? `${displayPath(configPath)} cannot be edited automatically`
            : `no ${tool.name} config found`;
          console.log(`[${tool.name}] ${where}. Add this manually:`);
          console.log('');
          console.log(tool.snippet(reference));
          console.log('');
          continue;
        }
        const reference = tool.reference(path.dirname(configPath), aggregate);
        const result = tool.apply(readFileSync(configPath, 'utf8'), reference);
        if (!result.changed) {
          console.log(
            result.reason === 'already-wired'
              ? `[${tool.name}] ${displayPath(configPath)} is already wired.`
              : `[${tool.name}] could not edit ${displayPath(configPath)} (${result.reason}). Add this manually:\n\n${tool.snippet(reference)}\n`,
          );
          continue;
        }
        if (options.dryRun) {
          console.log(
            `[${tool.name}] would wire ${displayPath(configPath)} -> ${displayPath(aggregate)}.`,
          );
          continue;
        }
        writeFileSync(configPath, result.content!);
        console.log(
          `[${tool.name}] wired ${displayPath(configPath)} -> ${displayPath(aggregate)}.`,
        );
      }
      if (!options.dryRun) console.log("Run 'archprint eject' to undo.");
    });

  program
    .command('eject')
    .description(
      "Remove archprint's generated files, its config manifest, and any wired references",
    )
    .option(
      '-o, --out <dir>',
      'output directory that holds the generated rule configs',
      'archprint-rules',
    )
    .option('--dry-run', 'list what would be removed without deleting anything')
    .action((options: { out: string; dryRun?: boolean }) => {
      const cwd = process.cwd();
      const outDir = path.resolve(options.out);
      const targets: string[] = [];
      for (const relative of readOutputs(outDir)) {
        const target = path.join(outDir, relative);
        if (existsSync(target)) targets.push(target);
      }
      const outputsManifest = path.join(outDir, OUTPUTS_MANIFEST_FILE);
      if (existsSync(outputsManifest)) targets.push(outputsManifest);
      const initManifest = path.resolve(INIT_MANIFEST_FILE);
      if (existsSync(initManifest)) targets.push(initManifest);
      const wired = WIRING_TOOLS.map((tool) => ({ tool, configPath: tool.findConfig(cwd) })).filter(
        (entry) =>
          entry.configPath !== null && entry.tool.isWired(readFileSync(entry.configPath, 'utf8')),
      );
      if (targets.length === 0 && wired.length === 0) {
        console.log('Nothing to eject: no archprint outputs found here.');
        return;
      }
      if (options.dryRun) {
        console.log('Would remove:');
        for (const target of targets) console.log(`  ${displayPath(target)}`);
        for (const { configPath } of wired) console.log(`  unwire ${displayPath(configPath!)}`);
        return;
      }
      for (const target of targets) rmSync(target, { recursive: true, force: true });
      removeIfEmpty(outDir);
      for (const { tool, configPath } of wired)
        writeFileSync(configPath!, tool.remove(readFileSync(configPath!, 'utf8')));
      console.log(`Ejected ${targets.length + wired.length} archprint artifact(s):`);
      for (const target of targets) console.log(`  removed ${displayPath(target)}`);
      for (const { configPath } of wired) console.log(`  unwired ${displayPath(configPath!)}`);
    });

  return program;
}
