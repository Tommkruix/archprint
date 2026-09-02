import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkSelfConsistency } from '../../src/index.js';
import { scanRepo } from '../../src/cli/scan.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => path.join(here, '..', 'fixtures', name);

describe('checkSelfConsistency', () => {
  it('passes: every AUTO rule inferred from a repo lists exactly the exceptions its gate recorded', () => {
    expect(checkSelfConsistency(scanRepo(fixture('layer-auto'), { deep: false }))).toEqual([]);
    expect(checkSelfConsistency(scanRepo(fixture('cli-auto'), { deep: false }))).toEqual([]);
  });

  it('catches an AUTO rule whose listed violations do not match its recorded exception count', () => {
    const scan = scanRepo(fixture('layer-auto'), { deep: false });
    const auto = scan.layerBoundaries.find((b) => b.gate.status === 'AUTO');
    expect(auto).toBeDefined();
    auto!.violations = [
      ...auto!.violations,
      { file: 'phantom-not-in-evidence.ts', specifier: 'x' },
    ];
    const issues = checkSelfConsistency(scan);
    expect(issues.some((i) => i.rule.startsWith('layer:'))).toBe(true);
  });
});
