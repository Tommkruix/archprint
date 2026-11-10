import { builtinModules } from 'node:module';
import { svelteKitModules } from './sveltekit.js';

/** The modules an app imports that no npm package provides: Node's builtins and its framework's virtual modules. */
export const coreModules = (appDir: string): ReadonlySet<string> =>
  new Set([...builtinModules, ...svelteKitModules(appDir)]);
