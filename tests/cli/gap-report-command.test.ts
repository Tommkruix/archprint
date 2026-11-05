import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProgram } from '../../src/cli/program.js';
import { writeTree } from '../integration/layer-app.js';

const mapping = {
  rules: [
    {
      template: 'forbid-usage',
      source: { file: 'CLAUDE.md', quote: 'Never call fetch in a component.' },
      name: 'no-fetch-in-components',
      files: ['src/components/**'],
      usage: ['fetch'],
    },
  ],
};

describe('archprint gap-report', () => {
  let root: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  const output = (): string =>
    logSpy.mock.calls.map((call: unknown[]) => call.join(' ')).join('\n');
  const run = (args: string[]): Promise<unknown> =>
    buildProgram('9.9.9').parseAsync(['gap-report', ...args], { from: 'user' });

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'archprint-gap-cli-'));
    writeTree(root, {
      'CLAUDE.md': '- Never call fetch in a component.\n',
      'tsconfig.json': '{}\n',
      'src/components/card.tsx': "export const Card = fetch('/x');\n",
      'mapping.json': JSON.stringify(mapping),
    });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    rmSync(root, { recursive: true, force: true });
  });

  it('prints the report for a mapping file, against the repository given', async () => {
    await run([path.join(root, 'mapping.json'), root]);
    expect(output()).toContain('Enforce with a baseline (broken today) (1)');
    expect(output()).toContain('      src/components/card.tsx:1  fetch');
  });

  it('prints JSON with --json', async () => {
    await run([path.join(root, 'mapping.json'), root, '--json']);
    expect(JSON.parse(output()).entries[0]).toMatchObject({
      id: 'doc-no-fetch-in-components',
      status: 'baseline',
    });
  });

  it('names a mapping that is not JSON', async () => {
    writeFileSync(path.join(root, 'mapping.json'), '{"rules":');
    await expect(run([path.join(root, 'mapping.json'), root])).rejects.toThrow(
      'The mapping is not valid JSON',
    );
  });
});
