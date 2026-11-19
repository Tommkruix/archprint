import { lstatSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { DeclaredAdoptedRule, StatedSentence } from './adopted-rules.js';
import { changedFiles, fileAtCommit } from './check-git.js';
import { contextSentences, readsLikeRule } from './context-sentences.js';
import { relocateSources } from './declared-adoption.js';
import { MAX_SOURCE_BYTES, normalize } from './source-quote.js';

export interface UncheckedSentence {
  line: number;
  text: string;
}

export interface ContextFileChange {
  /** Repo-relative, POSIX. */
  file: string;
  /** Sentences this change adds that no adopted rule quotes. */
  unchecked: number;
  /** Those of them that read like instructions, by line. */
  ruleLike: UncheckedSentence[];
}

export interface StaleDeclaredRule {
  rule: DeclaredAdoptedRule;
  /** Repo-relative, POSIX. */
  file: string;
}

export interface ContextReport {
  files: ContextFileChange[];
  stale: StaleDeclaredRule[];
}

const CONTEXT_NAMES = new Set([
  'CLAUDE.md',
  'AGENTS.md',
  'GEMINI.md',
  '.cursorrules',
  '.windsurfrules',
]);
const TOOL_DIR_FILE =
  /^(?:(.*)\/)?(?:\.github\/(?:copilot-instructions\.md|instructions\/[^/]+\.instructions\.md)|\.cursor\/rules\/.+\.mdc?)$/;

/** The directory whose code a context file speaks for, or null when the path is not a context file. */
export function contextOwner(file: string): string | null {
  const tool = TOOL_DIR_FILE.exec(file);
  if (tool !== null) return tool[1] ?? '';
  if (!CONTEXT_NAMES.has(path.posix.basename(file))) return null;
  const dir = path.posix.dirname(file);
  return dir === '.' ? '' : dir;
}

const within = (dir: string, ancestor: string): boolean =>
  ancestor === '' || dir === ancestor || dir.startsWith(`${ancestor}/`);

/** Whether a context file applies to the app: it sits in the app, below it, or in a directory above it. */
export const appliesToApp = (owner: string, appPrefix: string): boolean =>
  within(owner, appPrefix) || within(appPrefix, owner);

/** A context file's text, or null for one too large, unreadable, or a symlink (its target is read under its own path). */
function readText(file: string): string | null {
  try {
    const stat = lstatSync(file);
    return stat.isSymbolicLink() || stat.size > MAX_SOURCE_BYTES
      ? null
      : readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

const quotedBy = (sentence: string, statements: readonly string[]): boolean =>
  statements.some((statement) => sentence.includes(statement) || statement.includes(sentence));

function fileChange(
  root: string,
  commit: string,
  file: string,
  basePath: string | null,
  statements: readonly string[],
): ContextFileChange | null {
  const head = readText(path.join(root, file));
  if (head === null) return null;
  const base = basePath === null ? null : fileAtCommit(root, commit, basePath);
  const before = new Set(
    base === null ? [] : contextSentences(base).map((sentence) => sentence.text),
  );
  const unchecked = contextSentences(head).filter(
    (sentence) => !before.has(sentence.text) && !quotedBy(sentence.text, statements),
  );
  if (unchecked.length === 0) return null;
  return {
    file,
    unchecked: unchecked.length,
    ruleLike: unchecked.filter((sentence) => readsLikeRule(sentence.text)),
  };
}

/**
 * The context files (CLAUDE.md, AGENTS.md, ...) that apply to the app and that the working tree changes against
 * `commit`, each with the sentences it adds that no adopted rule quotes; and the declared rules whose sentence is gone.
 */
export function contextReport(options: {
  root: string;
  commit: string;
  appPrefix: string;
  rulesDir: string;
  declared: readonly DeclaredAdoptedRule[];
  stated: readonly StatedSentence[];
}): ContextReport {
  const { root, commit, appPrefix, rulesDir, declared, stated } = options;
  const statements = [
    ...declared.map((rule) => rule.statement),
    ...stated.map((entry) => entry.quote),
  ].map((text) => normalize(text).text);
  const files = changedFiles(root, commit)
    .filter((change) => {
      const owner = contextOwner(change.path);
      return owner !== null && appliesToApp(owner, appPrefix);
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((change) => fileChange(root, commit, change.path, change.basePath, statements))
    .filter((change): change is ContextFileChange => change !== null);
  const stale = relocateSources(declared, rulesDir).stale.map((rule) => ({
    rule,
    file: path
      .relative(root, path.resolve(rulesDir, rule.root, rule.source.file))
      .split(path.sep)
      .join('/'),
  }));
  return { files, stale };
}
