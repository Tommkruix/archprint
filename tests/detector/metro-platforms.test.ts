import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { metroFileFor, metroPlatformsUnder } from '../../src/detector/metro-platforms.js';
import { detectOrphans } from '../../src/detector/orphan-detector.js';
import { writeTree } from '../integration/layer-app.js';

const MODULE = 'export const value = 1;\n';
const manifest = (dependencies: Record<string, string>, peerDependencies = {}): string =>
  JSON.stringify({ name: 'app', private: true, dependencies, peerDependencies });

describe('React Native platform files, as Metro resolves them', () => {
  const temps: string[] = [];
  const repo = (files: Record<string, string>): string => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'archprint-metro-')));
    temps.push(dir);
    writeTree(dir, { 'tsconfig.json': '{}', ...files });
    return dir;
  };
  afterEach(() => {
    for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('links the variant each platform the project builds picks, and lists the rest', () => {
    const root = repo({
      'package.json': manifest({
        expo: '57.0.0',
        'react-native': '0.86.0',
        'react-native-web': '0.21.0',
      }),
      'src/provider.tsx': [
        "import { apply } from './apply-root-font';",
        "import { bars } from './system-bars';",
        "import { Button } from './button';",
        "import { Card } from './card';",
        "import { Widget } from './widget';",
        'export const all = [apply, bars, Button, Card, Widget];',
      ].join('\n'),
      'index.ts': "import './src/provider';\n",
      'src/apply-root-font.ts': MODULE,
      'src/apply-root-font.web.ts': MODULE,
      'src/system-bars.tsx': MODULE,
      'src/system-bars.android.tsx': MODULE,
      'src/button.tsx': MODULE,
      'src/button.ios.tsx': MODULE,
      'src/button.native.tsx': MODULE,
      'src/card.native.tsx': MODULE,
      'src/card.windows.tsx': MODULE,
      'src/widget/index.ios.tsx': MODULE,
      'src/widget/index.android.tsx': MODULE,
      'src/unused.web.tsx': MODULE,
    });
    const { orphans } = detectOrphans(root);
    for (const used of [
      'src/apply-root-font.ts',
      'src/apply-root-font.web.ts',
      'src/system-bars.tsx',
      'src/system-bars.android.tsx',
      'src/button.tsx',
      'src/button.ios.tsx',
      'src/button.native.tsx',
      'src/card.native.tsx',
      'src/widget/index.ios.tsx',
      'src/widget/index.android.tsx',
    ]) {
      expect(orphans, used).not.toContain(used);
    }
    expect(orphans).toContain('src/unused.web.tsx');
    expect(orphans).toContain('src/card.windows.tsx');
  });

  it('builds web only with react-native-web, and gives a shared package that peers on react-native the native platforms', () => {
    const root = repo({
      'package.json': manifest({ 'react-native': '0.86.0' }),
      'index.ts':
        "import { text } from './text';\nimport { ui } from './packages/ui/src';\nexport { text, ui };\n",
      'text.tsx': MODULE,
      'text.web.tsx': MODULE,
      'text.native.tsx': MODULE,
      'packages/ui/package.json': manifest({}, { 'react-native': '*' }),
      'packages/ui/src/index.ts': "export { ui } from './sheet';\n",
      'packages/ui/src/sheet.tsx': 'export const ui = 1;\n',
      'packages/ui/src/sheet.ios.tsx': 'export const ui = 1;\n',
      'packages/ui/src/sheet.web.tsx': 'export const ui = 1;\n',
    });
    const { orphans } = detectOrphans(root);
    expect(orphans).not.toContain('text.native.tsx');
    expect(orphans).toContain('text.web.tsx');
    expect(orphans).not.toContain('packages/ui/src/sheet.ios.tsx');
    expect(orphans).toContain('packages/ui/src/sheet.web.tsx');
  });

  it('leaves platform-named files of a project that is not React Native listed', () => {
    const root = repo({
      'package.json': manifest({ react: '19.0.0', 'react-native-web': '0.21.0' }),
      'index.ts': "export { value } from './storage';\n",
      'storage.ts': MODULE,
      'storage.web.ts': MODULE,
      'storage.native.ts': MODULE,
    });
    const { orphans } = detectOrphans(root);
    expect(orphans).toContain('storage.web.ts');
    expect(orphans).toContain('storage.native.ts');
  });

  it("follows Metro's order: each source extension in turn, platform file, then native, then plain", () => {
    const files = new Set([
      'a.js',
      'a.ios.ts',
      'b.native.ts',
      'b.ios.tsx',
      'c.web.tsx',
      'c.native.tsx',
      'd/index.native.tsx',
    ]);
    const isFile = (candidate: string): boolean => files.has(candidate);
    const ios = metroFileFor(isFile, { name: 'ios', preferNative: true });
    const web = metroFileFor(isFile, { name: 'web', preferNative: false });
    expect(ios('a')).toBe('a.js');
    expect(ios('b')).toBe('b.native.ts');
    expect(ios('a.ios.ts')).toBe('a.ios.ts');
    expect(ios('d')).toBe('d/index.native.tsx');
    expect(web('c')).toBe('c.web.tsx');
    expect(web('b')).toBeNull();
  });

  it('takes the platforms from the nearest package.json, and the optional ones from the root too', () => {
    const root = repo({
      'package.json': JSON.stringify({
        name: 'mono',
        private: true,
        devDependencies: { 'react-native-macos': '0.79.0', 'react-native-web': '0.21.0' },
      }),
      'apps/mobile/package.json': manifest({ 'react-native': '0.86.0' }),
      'apps/web/package.json': manifest({ next: '15.0.0' }),
    });
    const platformsOf = metroPlatformsUnder(root);
    expect(platformsOf('apps/mobile/src/deep/file.tsx')).toEqual([
      { name: 'ios', preferNative: true },
      { name: 'android', preferNative: true },
      { name: 'web', preferNative: false },
      { name: 'macos', preferNative: true },
    ]);
    expect(platformsOf('apps/web/src/page.tsx')).toEqual([]);
    expect(platformsOf('scripts/build.ts')).toEqual([]);
  });
});
