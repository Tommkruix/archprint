import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { locateImport } from '../../src/cli/codeframe.js';
import { guidanceFor } from '../../src/cli/rule-guidance.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, '..', 'fixtures', 'cli-auto');

describe('locateImport', () => {
  it('finds the line and trims the offending import statement', () => {
    const frame = locateImport(appDir, 'app/api/r14/route.ts', '@/lib/util');
    expect(frame).toEqual({ line: 1, text: "import { util } from '@/lib/util';" });
  });

  it('returns null when the file is unreadable', () => {
    expect(locateImport(appDir, 'does/not/exist.ts', '@/x')).toBeNull();
  });

  it('returns null when the specifier is not present', () => {
    expect(locateImport(appDir, 'app/api/r14/route.ts', '@/not/imported')).toBeNull();
  });
});

describe('guidanceFor', () => {
  it('returns rule-specific guidance for a known rule name', () => {
    const guidance = guidanceFor('no-db-client-in-request-entry');
    expect(guidance.howToFix).toContain('service or data-access');
    expect(guidance.whenNotToUse.length).toBeGreaterThan(0);
  });

  it('falls back to generic guidance for an unknown rule name', () => {
    const guidance = guidanceFor('some-unknown-rule');
    expect(guidance.howToFix.length).toBeGreaterThan(0);
    expect(guidance.whenNotToUse.length).toBeGreaterThan(0);
  });
});
