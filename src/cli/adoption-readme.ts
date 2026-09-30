import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const START = '<!-- archprint:start -->';
const END = '<!-- archprint:end -->';

export interface ReadmeResult {
  status: 'created' | 'updated' | 'skipped';
  reason?: string;
}

interface Layout {
  eol: string;
  bom: string;
}

function detectLayout(content: string): Layout {
  const bom = content.startsWith('﻿') ? '﻿' : '';
  const eol = /\r\n/.test(content) ? '\r\n' : '\n';
  return { eol, bom };
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
    if (!existsSync(readmePath)) {
      writeFileSync(readmePath, `${block(body, '\n')}\n`);
      return { status: 'created' };
    }
    const raw = readFileSync(readmePath, 'utf8');
    const { eol, bom } = detectLayout(raw);
    const content = bom ? raw.slice(bom.length) : raw;
    const start = content.indexOf(START);
    const end = content.indexOf(END);
    if ((start !== -1) !== (end !== -1) || (start !== -1 && end < start)) {
      return { status: 'skipped', reason: 'unpaired archprint markers in README; left untouched' };
    }
    const normalized = content.replace(/\r\n/g, '\n');
    const fresh = block(body, '\n');
    let next: string;
    if (start !== -1) {
      const s = normalized.indexOf(START);
      const e = normalized.indexOf(END) + END.length;
      next = normalized.slice(0, s) + fresh + normalized.slice(e);
    } else {
      next = `${normalized.replace(/\n+$/, '')}\n\n${fresh}\n`;
    }
    writeFileSync(readmePath, bom + (eol === '\r\n' ? next.replace(/\n/g, '\r\n') : next));
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
    const raw = readFileSync(readmePath, 'utf8');
    const { eol, bom } = detectLayout(raw);
    const content = (bom ? raw.slice(bom.length) : raw).replace(/\r\n/g, '\n');
    const start = content.indexOf(START);
    const end = content.indexOf(END);
    if (start === -1 || end === -1 || end < start) {
      return { status: 'skipped', reason: 'no archprint section' };
    }
    const head = content.slice(0, start).replace(/\n+$/, '');
    const tail = content.slice(end + END.length).replace(/^\n+/, '');
    const without = head === '' ? tail : tail === '' ? head : `${head}\n\n${tail}`;
    if (createdByArchprint && without.trim() === '') {
      rmSync(readmePath, { force: true });
      return { status: 'updated', reason: 'removed archprint-created README' };
    }
    const out = without.trim() === '' ? '' : `${without.replace(/\n+$/, '')}\n`;
    writeFileSync(readmePath, bom + (eol === '\r\n' ? out.replace(/\n/g, '\r\n') : out));
    return { status: 'updated' };
  } catch (error) {
    return { status: 'skipped', reason: `could not update README (${(error as Error).message})` };
  }
}
