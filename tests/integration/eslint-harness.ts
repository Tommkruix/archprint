import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ESLint } from 'eslint';

export const eslintOnly = {
  eslint: true,
  eslintPluginImport: false,
  dependencyCruiser: false,
  biome: false,
};

const TS_ESLINT = pathToFileURL(createRequire(import.meta.url).resolve('typescript-eslint')).href;

/** An eslint.config.mjs at `root` that parses TypeScript and adopts the generated archprint rules. */
export function lintConfig(root: string, archprintPath: string): string {
  const configPath = path.join(root, 'eslint.config.mjs');
  writeFileSync(
    configPath,
    [
      `import tseslint from '${TS_ESLINT}';`,
      `import archprint from '${archprintPath}';`,
      "export default [{ files: ['**/*.{ts,tsx}'], languageOptions: { parser: tseslint.parser } }, ...archprint];",
      '',
    ].join('\n'),
  );
  return configPath;
}

/** How many times `ruleId` reports `source` linted as `filePath`. */
export const ruleHits = async (
  eslint: ESLint,
  ruleId: string,
  source: string,
  filePath: string,
): Promise<number> =>
  (await eslint.lintText(source, { filePath }))[0]!.messages.filter(
    (message) => message.ruleId === ruleId,
  ).length;
