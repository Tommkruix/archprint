import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Command } from 'commander';
import { checkSelfConsistency } from '../detector/self-consistency.js';
import { discoverAppDirs } from '../scanner/app-dirs.js';
import { detectEnforcers, type InstalledEnforcers } from '../scanner/enforcers.js';
import { hasTsConfig, scanRepo, type ScanResult, type ScannedPattern } from './scan.js';
import {
  renderAdoptionBody,
  renderExplain,
  renderInit,
  renderReport,
  renderRecommendations,
} from './report.js';
import { buildRecommendations, detectStack } from './recommend.js';
import { toScanSummary } from './summary.js';
import { ARCHPRINT_DIR, ESLINT_FILE, FAMILY_NAMES, emitOne } from './generate.js';
import { writeLayout } from './layout.js';
import { CONFIG_FILE, readConfig, recordManagedFiles } from './archprint-config.js';
import { stripAdoptionSection } from './adoption-readme.js';
import { removeIgnoreEntry } from './ignore-file.js';
import { OUTPUTS_MANIFEST_FILE, readOutputs, removeIfEmpty } from './outputs-manifest.js';
import { LEGACY_DIR, hasLegacyLayout, runMigration } from './migrate.js';
import { WIRING_TOOLS } from './wiring.js';

const LEGACY_ROOT_CONFIG = 'archprint.json';

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

const EMIT_TARGETS = ['eslint', 'dependency-cruiser', 'all'];

function applyEmitOverride(detected: InstalledEnforcers, emit?: string): InstalledEnforcers {
  switch (emit) {
    case 'eslint':
      return { ...detected, eslint: true, dependencyCruiser: false };
    case 'dependency-cruiser':
      return { ...detected, eslint: false, dependencyCruiser: true };
    case 'all':
      return { ...detected, eslint: true, dependencyCruiser: true };
    default:
      return detected;
  }
}

export async function runEslintCheck(appDir: string, outDir: string): Promise<void> {
  const rulesFile = path.join(outDir, ESLINT_FILE);
  if (!existsSync(rulesFile)) {
    console.log('Check: no eslint rules were generated to check.');
    return;
  }
  const [{ ESLint }, tseslint, generated] = await Promise.all([
    import('eslint'),
    import('typescript-eslint'),
    import(pathToFileURL(rulesFile).href) as Promise<{ default: unknown[] }>,
  ]);
  const archprintRuleIds = new Set<string>();
  for (const block of generated.default) {
    const rules = (block as { rules?: Record<string, unknown> }).rules;
    if (rules) for (const id of Object.keys(rules)) archprintRuleIds.add(id);
  }
  const config = [
    { files: ['**/*.{ts,tsx}'], languageOptions: { parser: tseslint.default.parser } },
    ...generated.default,
  ];
  const eslint = new ESLint({
    cwd: appDir,
    overrideConfigFile: true,
    overrideConfig: config as never,
  });
  let results;
  /* v8 ignore start -- defensive: eslint throws only on an unresolved rule (e.g. an unregistered plugin) */
  try {
    results = await eslint.lintFiles(['**/*.{ts,tsx}']);
  } catch (error) {
    console.log(`Check: could not run eslint (${(error as Error).message}).`);
    process.exitCode = 1;
    return;
  }
  /* v8 ignore stop */
  const offends = (message: { ruleId: string | null; severity: number }): boolean =>
    message.severity === 2 && message.ruleId !== null && archprintRuleIds.has(message.ruleId);
  const offenders = results.filter((result) => result.messages.some(offends));
  const count = offenders.reduce((total, r) => total + r.messages.filter(offends).length, 0);
  const unparsed = results.filter((result) => result.messages.some((m) => m.fatal));
  if (unparsed.length > 0) {
    console.log(`Check: ${unparsed.length} file(s) could not be parsed, so they were not checked:`);
    for (const result of unparsed.slice(0, 10))
      console.log(`  ${path.relative(appDir, result.filePath)}`);
    process.exitCode = 1;
  }
  if (count === 0) {
    if (unparsed.length === 0)
      console.log('Check: the generated eslint rules pass clean on this repo.');
    return;
  }
  console.log(`Check: ${count} violation(s) of the generated rules:`);
  for (const result of offenders.slice(0, 10)) {
    const rules = [...new Set(result.messages.filter(offends).map((m) => m.ruleId))];
    console.log(`  ${path.relative(appDir, result.filePath)}: ${rules.join(', ')}`);
  }
  process.exitCode = 1;
}

function resolveApp(input: string): string {
  const appDir = path.resolve(input);
  if (hasTsConfig(appDir)) return appDir;
  const discovered = discoverAppDirs(appDir);
  if (discovered.length === 1) return discovered[0]!;
  if (discovered.length > 1) {
    const list = discovered.map((dir) => `  ${displayPath(dir, appDir)}`).join('\n');
    throw new Error(
      `No tsconfig.json in ${displayPath(appDir)}, but found ${discovered.length} app directories. Point archprint at one (e.g. \`${displayPath(discovered[0]!, appDir)}\`):\n${list}`,
    );
  }
  throw new Error(
    `No tsconfig.json in ${appDir}. Point archprint at an app directory (for a monorepo, e.g. apps/web).`,
  );
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
    .option('-o, --out <dir>', 'output directory for the generated rules', ARCHPRINT_DIR)
    .option('--fast', 'skip barrel/alias resolution (faster, less accurate)')
    .option(
      '--include-structural',
      'also enforce the structural-inference families (held for review by default)',
    )
    .option('--expand', 'also write the per-family files, rule cards, and fixtures')
    .option('--force', `overwrite an existing ${ARCHPRINT_DIR}/${CONFIG_FILE} and rules`)
    .action(
      (
        input: string,
        options: {
          out: string;
          fast?: boolean;
          includeStructural?: boolean;
          expand?: boolean;
          force?: boolean;
        },
      ) => {
        const appDir = resolveApp(input);
        const cwd = process.cwd();
        if (hasLegacyLayout(cwd)) {
          console.error(
            `Found an older archprint layout (${LEGACY_DIR}/). Run 'archprint migrate' to upgrade it first.`,
          );
          process.exitCode = 1;
          return;
        }
        const outDir = path.resolve(options.out);
        if (readConfig(outDir) !== null && !options.force) {
          console.error(
            `${path.join(options.out, CONFIG_FILE)} already exists. Re-run with --force to overwrite, or use 'archprint generate' directly.`,
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
        const structural = options.includeStructural ?? false;
        const enforcers = detectEnforcers(scan.appDir);
        const recommendations = buildRecommendations(scan, detectStack(appDir), enforcers);
        const { files } = writeLayout(scan, outDir, {
          structural,
          enforcers,
          expand: options.expand,
          version,
          recommendations,
          app: displayPath(appDir, cwd),
          cwd,
          readmeBody: renderAdoptionBody(recommendations),
        });
        const config = readConfig(outDir);
        /* v8 ignore next -- writeLayout always writes a readable config */
        if (config === null) return;
        console.log(renderInit(config, files.length, structural, version));
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
    .description('Write the archprint rules for every AUTO pattern (resolves the graph by default)')
    .argument('[path]', 'app directory', '.')
    .option('-o, --out <dir>', 'output directory', ARCHPRINT_DIR)
    .option(
      '--fast',
      'skip barrel/alias resolution (faster, may mint a rule the full graph rejects)',
    )
    .option(
      '--include-structural',
      'also emit the structural-inference families (layer, role, entry-purity, ui/data, server/client, feature-slice, app-isolation, stories, env, workspace-package) as AUTO. Held for review by default: the Phase A audit found their inferred layers/roles can be wrong; review before enforcing.',
    )
    .option(
      '--rule <id>',
      'emit a single rule by id (e.g. AP-001) after reviewing its evidence with `explain`, including a SUGGEST rule',
    )
    .option(
      '--emit <target>',
      'force the output format regardless of detected tooling: eslint, dependency-cruiser, or all',
    )
    .option('--no-graph', 'skip the layer dependency graph (Mermaid and Graphviz, with --expand)')
    .option('--expand', 'also write the per-family files, rule cards, fixtures, and graph')
    .option('--readme', 'also add an archprint section to README.md summarizing what is enforced')
    .option('--only <family>', `emit only one rule family (${FAMILY_NAMES.join(', ')})`)
    .option(
      '--rules <ids>',
      'emit only these forbidden-import rule ids (comma-separated, e.g. AP-001,AP-002)',
    )
    .option(
      '--check',
      'after generating, run the eslint rules against the repo and report pass/fail',
    )
    .action(
      async (
        input: string,
        options: {
          out: string;
          fast?: boolean;
          includeStructural?: boolean;
          rule?: string;
          emit?: string;
          graph?: boolean;
          expand?: boolean;
          readme?: boolean;
          only?: string;
          rules?: string;
          check?: boolean;
        },
      ) => {
        if (options.emit !== undefined && !EMIT_TARGETS.includes(options.emit)) {
          console.error(
            `Invalid --emit target '${options.emit}'. Use: ${EMIT_TARGETS.join(', ')}.`,
          );
          process.exitCode = 1;
          return;
        }
        if (
          options.only !== undefined &&
          !(FAMILY_NAMES as readonly string[]).includes(options.only)
        ) {
          console.error(
            `Invalid --only family '${options.only}'. Use one of: ${FAMILY_NAMES.join(', ')}.`,
          );
          process.exitCode = 1;
          return;
        }
        if (hasLegacyLayout(process.cwd())) {
          console.error(
            `Found an older archprint layout (${LEGACY_DIR}/). Run 'archprint migrate' to upgrade it first.`,
          );
          process.exitCode = 1;
          return;
        }
        if (options.rule !== undefined) {
          const cwd = process.cwd();
          const outDir = path.resolve(options.out);
          const { appDir, pattern } = findPattern(input, options.rule, !options.fast);
          const dir = emitOne(pattern, appDir, outDir);
          recordManagedFiles(outDir, cwd, version, [dir]);
          console.log(`generated ${path.relative(cwd, dir)}/`);
          if (options.fast) {
            console.log(
              'Warning: generated from a fast specifier-level scan; re-run without --fast to confirm no barrel/alias-hidden violations before enforcing.',
            );
          }
          return;
        }
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
        const cwd = process.cwd();
        const outDir = path.resolve(options.out);
        const structural = options.includeStructural ?? false;
        const heldStructuralAuto = structural ? 0 : countStructuralAuto(scan);
        const enforcers = applyEmitOverride(detectEnforcers(scan.appDir), options.emit);
        const recommendations = buildRecommendations(scan, detectStack(scan.appDir), enforcers);
        const ruleIds = options.rules
          ? options.rules
              .split(',')
              .map((id) => id.trim())
              .filter(Boolean)
          : undefined;
        const { files, removed } = writeLayout(scan, outDir, {
          structural,
          enforcers,
          graph: options.graph,
          expand: options.expand,
          only: options.only,
          ruleIds,
          version,
          recommendations,
          app: displayPath(scan.appDir, cwd),
          cwd,
          readmeBody: options.readme ? renderAdoptionBody(recommendations) : undefined,
        });
        if (removed.length > 0) {
          console.log(
            `Refreshed: removed ${removed.length} stale archprint output(s) before writing.`,
          );
        }
        if (files.length === 0) {
          if (heldStructuralAuto > 0) {
            console.log(
              `No mechanical AUTO rules to generate. ${heldStructuralAuto} structural rule(s) are held for review; pass --include-structural to emit them (review before enforcing).`,
            );
          } else {
            console.log('No AUTO rules to generate.');
          }
          return;
        }
        for (const file of files) {
          const relative = path.relative(cwd, file);
          console.log(`generated ${relative.startsWith('..') ? file : relative}`);
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
        if (options.check) await runEslintCheck(scan.appDir, outDir);
      },
    );

  program
    .command('recommend')
    .description('Recommend a rule set for this repo (or a fresh one) from its stack and evidence')
    .argument('[path]', 'app directory', '.')
    .option('--json', 'emit a machine-readable JSON summary instead of the human report')
    .action((input: string, options: { json?: boolean }) => {
      const root = path.resolve(input);
      const appDirs = discoverAppDirs(root);
      if (appDirs.length === 0) {
        throw new Error(
          `No tsconfig.json found under ${root}. Point archprint at an app directory (a directory with a tsconfig.json); a monorepo root is fine.`,
        );
      }
      const recommendFor = (appDir: string) =>
        buildRecommendations(
          scanRepo(appDir, { deep: false }),
          detectStack(appDir),
          detectEnforcers(appDir),
        );
      if (options.json) {
        const apps = appDirs.map((appDir) => ({
          app: displayPath(appDir, root),
          ...recommendFor(appDir),
        }));
        console.log(JSON.stringify({ archprintVersion: version, apps }, null, 2));
        return;
      }
      const reports = appDirs.map((appDir) => {
        const label = appDirs.length > 1 ? `### ${path.relative(root, appDir) || '.'}\n` : '';
        return label + renderRecommendations(recommendFor(appDir), version);
      });
      console.log(reports.join('\n\n'));
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
    .command('wire')
    .description(
      "Reference archprint's generated rules from the enforcement tools your repo uses (managed, reversible)",
    )
    .option('-o, --out <dir>', 'output directory that holds the generated rules', ARCHPRINT_DIR)
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
    .description("Remove archprint's generated files, its config, and any wired references")
    .option('-o, --out <dir>', 'output directory that holds the generated rules', ARCHPRINT_DIR)
    .option('--dry-run', 'list what would be removed without deleting anything')
    .action((options: { out: string; dryRun?: boolean }) => {
      const cwd = process.cwd();
      const outDir = path.resolve(options.out);
      const config = readConfig(outDir);
      const targets: string[] = [];
      const add = (file: string): void => {
        if (existsSync(file) && !targets.includes(file)) targets.push(file);
      };
      if (config) for (const relative of config.managed.files) add(path.resolve(cwd, relative));
      for (const relative of readOutputs(outDir)) add(path.join(outDir, relative));
      add(path.join(outDir, OUTPUTS_MANIFEST_FILE));
      add(path.join(outDir, CONFIG_FILE));
      add(path.resolve(cwd, LEGACY_ROOT_CONFIG));
      const legacyDir = path.resolve(cwd, LEGACY_DIR);
      if (legacyDir !== outDir) {
        for (const relative of readOutputs(legacyDir)) add(path.join(legacyDir, relative));
        add(path.join(legacyDir, OUTPUTS_MANIFEST_FILE));
        add(legacyDir);
      }
      const wired = WIRING_TOOLS.map((tool) => ({ tool, configPath: tool.findConfig(cwd) })).filter(
        (entry) =>
          entry.configPath !== null && entry.tool.isWired(readFileSync(entry.configPath, 'utf8')),
      );
      const readmePath = path.join(cwd, 'README.md');
      const stripReadme = config?.managed.readme === true;
      if (targets.length === 0 && wired.length === 0 && !stripReadme) {
        console.log('Nothing to eject: no archprint outputs found here.');
        return;
      }
      if (options.dryRun) {
        console.log('Would remove:');
        for (const target of targets) console.log(`  ${displayPath(target)}`);
        for (const { configPath } of wired) console.log(`  unwire ${displayPath(configPath!)}`);
        if (stripReadme) console.log(`  strip archprint section from ${displayPath(readmePath)}`);
        return;
      }
      for (const { tool, configPath } of wired)
        writeFileSync(configPath!, tool.remove(readFileSync(configPath!, 'utf8')));
      for (const target of targets) rmSync(target, { recursive: true, force: true });
      removeIfEmpty(outDir);
      if (stripReadme) stripAdoptionSection(readmePath, config!.managed.readmeCreated);
      if (config?.managed.prettierignore)
        removeIgnoreEntry(path.join(cwd, '.prettierignore'), {
          deleteIfEmpty: config.managed.prettierignoreCreated,
        });
      if (config?.managed.npmignore)
        removeIgnoreEntry(path.join(cwd, '.npmignore'), {
          deleteIfEmpty: config.managed.npmignoreCreated,
        });
      console.log(`Ejected ${targets.length + wired.length} archprint artifact(s):`);
      for (const target of targets) console.log(`  removed ${displayPath(target)}`);
      for (const { configPath } of wired) console.log(`  unwired ${displayPath(configPath!)}`);
    });

  program
    .command('migrate')
    .alias('upgrade')
    .description(
      'Migrate an older archprint setup (archprint-rules/) to the current .archprint layout. Run after updating the package.',
    )
    .option('--dry-run', 'show what would change without writing')
    .action((options: { dryRun?: boolean }) => {
      const result = runMigration(process.cwd(), version, { dryRun: options.dryRun });
      if (result.status === 'nothing') {
        console.log('Nothing to migrate: no older archprint layout found here.');
        return;
      }
      if (result.status === 'aborted') {
        console.error(`Migration stopped, nothing changed. ${result.reason}`);
        process.exitCode = 1;
        return;
      }
      console.log(
        options.dryRun
          ? 'Would migrate to the .archprint layout:'
          : 'Migrated to the .archprint layout:',
      );
      for (const file of result.written)
        console.log(`  ${options.dryRun ? 'write' : 'wrote'} ${file}`);
      for (const edit of result.edited)
        console.log(`  ${options.dryRun ? 'rewire' : 'rewired'} ${edit}`);
      for (const target of result.removed)
        console.log(`  ${options.dryRun ? 'remove' : 'removed'} ${target}`);
      if (!options.dryRun) console.log("Run 'archprint eject' to undo.");
    });

  return program;
}
