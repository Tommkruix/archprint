import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { discoverAppDirs } from '../scanner/app-dirs.js';
import { hasTsConfig, scanRepo, type ScannedPattern } from './scan.js';
import { renderExplain, renderReport } from './report.js';
import { emitOne, writeGraph, writeLayerConfig, writeRules } from './generate.js';

export function readVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return (
    JSON.parse(readFileSync(path.join(here, '..', '..', 'package.json'), 'utf8')) as {
      version: string;
    }
  ).version;
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

/** Build the archprint CLI. Errors throw (the bin shim prints + exits); `.exitOverride()` lets tests drive it. */
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
    .action((input: string, options: { out: string; fast?: boolean }) => {
      // Generation is the commitment point, so it gates on the full graph by default; --fast opts out.
      const scan = scanRepo(resolveApp(input), { deep: !options.fast });
      const outDir = path.resolve(options.out);
      const written = writeRules(scan, outDir, ['AUTO']);
      const layerFiles = writeLayerConfig(scan, outDir, ['AUTO']);
      const graphFiles = writeGraph(scan, outDir);
      if (written.length === 0 && layerFiles.length === 0 && graphFiles.length === 0) {
        console.log('No AUTO rules to generate.');
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
      for (const file of graphFiles) report(file);
      if (graphFiles.length > 0) {
        console.log('  (layer dependency graph: Mermaid and Graphviz DOT)');
      }
      if (options.fast) {
        console.log(
          'Warning: generated from a fast specifier-level scan; re-run without --fast to confirm no barrel/alias-hidden violations before enforcing.',
        );
      }
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
