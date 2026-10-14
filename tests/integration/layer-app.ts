import { mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

export function writeTree(root: string, files: Record<string, string>): void {
  for (const [file, source] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), source);
  }
}

/** A Next.js app whose lib layer never imports the app layer, except one known file. */
export function nextApp(): Record<string, string> {
  const files: Record<string, string> = {
    'tsconfig.json': JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } },
    }),
    'src/app/page.tsx': 'export const Page = 1;\nexport type PageProps = { id: string };\n',
    'src/lib/legacy.ts': "import { Page } from '../app/page';\nexport const legacy = Page;\n",
    'src/lib/legacy.test.ts': "import { Page } from '../app/page';\nexport const t = Page;\n",
  };
  for (let i = 0; i < 60; i += 1) files[`src/lib/l${i}.ts`] = `export const lib${i} = ${i};\n`;
  for (let i = 0; i < 40; i += 1) {
    files[`src/app/route${i}/page.tsx`] =
      i % 2 === 0
        ? `import { lib${i} } from '@/lib/l${i}';\nexport const page${i} = lib${i};\n`
        : `import { lib${i} } from '../../lib/l${i}';\nexport const page${i} = lib${i};\n`;
  }
  return files;
}
