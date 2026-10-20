/**
 * A Next.js app whose client components never import server-only code and whose imports are all declared,
 * except one known file each.
 */
export function dependencyApp(): Record<string, string> {
  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      name: 'web',
      dependencies: { react: '19.0.0', next: '16.0.0', 'server-only': '0.0.1' },
    }),
    'tsconfig.json': JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } },
    }),
    'src/lib/db.ts': "import 'server-only';\nexport const db = { query: () => 1 };\n",
    'src/lib/note.ts':
      "// clients may import this; it is not 'server-only'\nexport const note = 1;\n",
    'src/lib/legacy-phantom.ts': "import { debounce } from 'lodash';\nexport const d = debounce;\n",
    'src/components/legacy-client.tsx':
      "'use client';\nimport { db } from '@/lib/db';\nexport const Legacy = () => db.query();\n",
    'src/app/page.tsx':
      "import { db } from '@/lib/db';\nexport default function Page() { return db.query(); }\n",
  };
  for (let i = 0; i < 60; i += 1) {
    files[`src/components/c${i}.tsx`] =
      `'use client';\nimport { useState } from 'react';\nimport { note } from '@/lib/note';\nexport const C${i} = () => useState(note);\n`;
  }
  return files;
}
