import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectOrphans } from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'orphans');

describe('detectOrphans', () => {
  it('reports a file that nothing imports and is not a framework entry', () => {
    const analysis = detectOrphans(fixture);
    expect(analysis.orphans).toEqual(['lib/orphan.ts']);
  });

  it('does not flag framework entries (page) or config files with zero in-degree', () => {
    const analysis = detectOrphans(fixture);
    expect(analysis.orphans).not.toContain('page.tsx');
    expect(analysis.orphans).not.toContain('app.config.ts');
  });

  it('excludes test files from the analysis entirely', () => {
    const analysis = detectOrphans(fixture);
    expect(analysis.orphans).not.toContain('lib/widget.test.ts');
    expect(analysis.fileCount).toBe(4);
  });

  it('is robust to a relative appDir', () => {
    const relative = path.relative(process.cwd(), fixture);
    const analysis = detectOrphans(relative);
    expect(analysis.orphans).toEqual(['lib/orphan.ts']);
  });

  describe('in a Next.js app with Storybook, Vitest, type-only imports and barrels', () => {
    let app: string;
    beforeAll(() => {
      app = mkdtempSync(path.join(tmpdir(), 'archprint-orphans-'));
      const files: Record<string, string> = {
        'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['./*'] } } }),
        'app/page.tsx':
          "import { list } from '@/lib/api/all';\nimport type { Pm } from '@/types/pm';\nexport default function Page(p: Pm) { return list(p); }\n",
        'app/robots.ts': 'export default function robots() { return {}; }\n',
        'app/sitemap.ts': 'export default function sitemap() { return []; }\n',
        'app/blog/opengraph-image.tsx': 'export default function Image() { return null; }\n',
        'instrumentation-client.ts': 'export const onRouterTransitionStart = () => {};\n',
        'proxy.ts': 'export function proxy() {}\n',
        'components/button.tsx': 'export const Button = () => null;\n',
        'components/button.stories.tsx':
          "import { Button } from './button';\nexport default { component: Button };\n",
        'vitest.config.ts': "export default { test: { setupFiles: ['./vitest.setup.ts'] } };\n",
        'vitest.setup.ts': 'export {};\n',
        'types/pm.ts': 'export interface Pm { id: string }\n',
        'lib/api/all.ts': "export * from './leaf';\n",
        'lib/api/leaf.ts': 'export const list = (p: unknown) => p;\n',
        'components/pm-view.tsx': 'export const PmView = () => null;\n',
        'components/pm-view.test.tsx':
          "import { PmView } from './pm-view';\nexport const t = PmView;\n",
        'lib/unused.ts': 'export const unused = 1;\n',
      };
      for (const [file, content] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(app, file)), { recursive: true });
        writeFileSync(path.join(app, file), content);
      }
    });
    afterAll(() => rmSync(app, { recursive: true, force: true }));

    it('reports only the file nothing references as an orphan', () => {
      expect(detectOrphans(app).orphans).toEqual(['lib/unused.ts']);
    });

    it('reports a production file only its test imports separately', () => {
      expect(detectOrphans(app).testOnly).toEqual(['components/pm-view.tsx']);
    });
  });
});
