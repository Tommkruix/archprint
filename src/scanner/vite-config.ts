import { existsSync } from 'node:fs';
import * as path from 'node:path';

/** Vite's config file names in the order it looks for them (DEFAULT_CONFIG_FILES). */
export const VITE_CONFIG_NAMES = ['js', 'mjs', 'ts', 'cjs', 'mts', 'cts'].map(
  (ext) => `vite.config.${ext}`,
);

/** The Vite config Vite picks in a folder; undefined when it has none. */
export const viteConfigIn = (dir: string): string | undefined =>
  VITE_CONFIG_NAMES.map((name) => path.join(dir, name)).find(existsSync);
