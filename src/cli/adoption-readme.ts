import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { staysInsideItsFolder } from '../generator/owned-paths.js';
import { lineBreakAt, lineBreakBefore, lineBreakOf } from './line-breaks.js';

const START = '<!-- archprint:start -->';
const END = '<!-- archprint:end -->';

export interface ReadmeResult {
  status: 'created' | 'updated' | 'skipped';
  reason?: string;
}

function block(body: string, eol: string): string {
  const lines = [
    '## Architecture rules (managed by archprint, do not edit between the markers)',
    '',
    body.trim(),
  ];
  return [START, ...lines, END].join(eol);
}

export function injectAdoptionSection(readmePath: string, body: string): ReadmeResult {
  try {
    if (!staysInsideItsFolder(readmePath))
      return {
        status: 'skipped',
        reason: 'README.md links outside the repository, so archprint leaves it alone',
      };
    if (!existsSync(readmePath)) {
      writeFileSync(readmePath, `${block(body, '\n')}\n`);
      return { status: 'created' };
    }
    const content = readFileSync(readmePath, 'utf8');
    const start = content.indexOf(START);
    const end = content.indexOf(END);
    if ((start !== -1) !== (end !== -1) || (start !== -1 && end < start)) {
      return { status: 'skipped', reason: 'unpaired archprint markers in README; left untouched' };
    }
    const eol = lineBreakOf(content);
    const fresh = block(body, eol);
    writeFileSync(
      readmePath,
      start !== -1
        ? content.slice(0, start) + fresh + content.slice(end + END.length)
        : `${content}${eol}${fresh}${eol}`,
    );
    return { status: 'updated' };
  } catch (error) {
    return { status: 'skipped', reason: `could not write README (${(error as Error).message})` };
  }
}

export function stripAdoptionSection(
  readmePath: string,
  createdByArchprint: boolean,
): ReadmeResult {
  try {
    if (!existsSync(readmePath)) return { status: 'skipped', reason: 'no README' };
    if (!staysInsideItsFolder(readmePath))
      return {
        status: 'skipped',
        reason: 'README.md links outside the repository, so archprint leaves it alone',
      };
    const content = readFileSync(readmePath, 'utf8');
    const start = content.indexOf(START);
    const end = content.indexOf(END);
    if (start === -1 || end === -1 || end < start) {
      return { status: 'skipped', reason: 'no archprint section' };
    }
    const blockEnd = end + END.length;
    const without =
      content.slice(0, start - lineBreakBefore(content, start)) +
      content.slice(blockEnd + lineBreakAt(content, blockEnd));
    if (createdByArchprint && without.trim() === '') {
      rmSync(readmePath, { force: true });
      return { status: 'updated', reason: 'removed archprint-created README' };
    }
    writeFileSync(readmePath, without);
    return { status: 'updated' };
  } catch (error) {
    return { status: 'skipped', reason: `could not update README (${(error as Error).message})` };
  }
}
