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
});
