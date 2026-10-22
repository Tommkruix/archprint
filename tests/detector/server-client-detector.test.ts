import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectServerClientBoundary } from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'server-client');

describe('detectServerClientBoundary', () => {
  it('flags use-client modules that import a server-only module, sorted', () => {
    const analysis = detectServerClientBoundary(fixture);
    expect(analysis.clientCount).toBe(3);
    expect(analysis.offenderCount).toBe(2);
    expect(analysis.violations).toEqual([
      { file: 'src/Client.tsx', target: 'src/db.ts' },
      { file: 'src/Client2.tsx', target: 'src/db.ts' },
    ]);
  });

  it('is robust to a relative appDir', () => {
    const relative = path.relative(process.cwd(), fixture);
    expect(detectServerClientBoundary(relative).offenderCount).toBe(2);
  });

  it('reports no client modules for a codebase without use-client', () => {
    const analysis = detectServerClientBoundary(path.join(here, '..', 'fixtures', 'layers'));
    expect(analysis.clientCount).toBe(0);
    expect(analysis.offenderCount).toBe(0);
  });

  it('counts a module as server-only when it imports the package, not when it mentions it', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'archprint-server-client-'));
    try {
      const files: Record<string, string> = {
        'lib/db.ts': "import 'server-only';\nexport const q = 1;\n",
        'lib/note.ts':
          "// imported by clients, never 'server-only'\nexport const n = 'server-only docs';\n",
        'components/ok.tsx':
          "'use client';\nimport { n } from '../lib/note';\nexport const A = n;\n",
        'components/bad.tsx':
          "'use client';\nimport { q } from '../lib/db';\nexport const B = q;\n",
      };
      for (const [file, source] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        writeFileSync(path.join(dir, file), source);
      }
      const analysis = detectServerClientBoundary(dir);
      expect(analysis.serverModules).toEqual(['lib/db.ts']);
      expect(analysis.clients).toEqual(['components/bad.tsx', 'components/ok.tsx']);
      expect(analysis.violations).toEqual([{ file: 'components/bad.tsx', target: 'lib/db.ts' }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
