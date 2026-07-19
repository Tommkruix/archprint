import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { hasTsConfig, scanRepo, type ScannedPattern } from './scan.js';
import { renderExplain, renderReport } from './report.js';
import { emitOne, writeRules } from './generate.js';

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
      const appDir = resolveApp(input);
      const started = performance.now();
      const scan = scanRepo(appDir, { deep: options.deep });
      console.log(renderReport(scan, version, performance.now() - started, options.deep));
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
      const written = writeRules(scan, path.resolve(options.out), ['AUTO']);
      if (written.length === 0) {
        console.log('No AUTO patterns to generate.');
        return;
      }
      for (const dir of written) {
        const relative = path.relative(process.cwd(), dir);
        console.log(`generated ${relative.startsWith('..') ? dir : relative}/`);
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
