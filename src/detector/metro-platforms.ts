import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { declaredPackages } from '../scanner/package-name.js';

/** A platform Metro bundles for; every platform but web prefers `.native` files (Expo turns it off for web). */
export interface MetroPlatform {
  name: string;
  preferNative: boolean;
}

const platform = (name: string): MetroPlatform => ({ name, preferNative: name !== 'web' });

const NATIVE_PLATFORMS = [platform('ios'), platform('android')];

/** Platforms a React Native project builds only when it declares the package that brings them. */
const PLATFORM_PACKAGES: readonly (readonly [string, MetroPlatform])[] = [
  ['react-native-web', platform('web')],
  ['react-native-windows', platform('windows')],
  ['react-native-macos', platform('macos')],
  ['react-native-tvos', platform('tvos')],
];

const METRO_PROJECT_PACKAGES = ['react-native', 'expo'];

/** Metro's default `resolver.sourceExts`, in the order it tries them. */
const METRO_SOURCE_EXTENSIONS = ['.js', '.jsx', '.json', '.ts', '.tsx'];

function declaredIn(dir: string): string[] {
  try {
    return declaredPackages(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return [];
  }
}

/**
 * The platforms Metro bundles each file under `root` for: ios and android when the file's nearest package.json declares
 * `react-native` or `expo`, plus web, windows, macos or tvos when it or the root package.json declares the package that
 * brings that platform; none outside a React Native project.
 */
export function metroPlatformsUnder(
  root: string,
): (relativePath: string) => readonly MetroPlatform[] {
  const rootDeclared = declaredIn(root);
  const byDir = new Map<string, readonly MetroPlatform[]>();
  const platformsAt = (dir: string): readonly MetroPlatform[] => {
    let known = byDir.get(dir);
    if (known === undefined) {
      const absoluteDir = path.join(root, dir);
      if (existsSync(path.join(absoluteDir, 'package.json'))) {
        const declared = declaredIn(absoluteDir);
        known = METRO_PROJECT_PACKAGES.some((name) => declared.includes(name))
          ? [
              ...NATIVE_PLATFORMS,
              ...PLATFORM_PACKAGES.filter(
                ([name]) => declared.includes(name) || rootDeclared.includes(name),
              ).map(([, brought]) => brought),
            ]
          : [];
      } else {
        known = dir === '' ? [] : platformsAt(path.posix.dirname(dir).replace(/^\.$/, ''));
      }
      byDir.set(dir, known);
    }
    return known;
  };
  return (relativePath) => platformsAt(path.posix.dirname(relativePath).replace(/^\.$/, ''));
}

/**
 * The file Metro resolves a path to when bundling for one platform: the path itself when it is a file, else, for each
 * source extension in order, `<path>.<platform><ext>`, then `<path>.native<ext>` when the platform prefers native files,
 * then `<path><ext>`; the same for `<path>/index`.
 */
export const metroFileFor =
  (isFile: (candidate: string) => boolean, { name, preferNative }: MetroPlatform) =>
  (base: string): string | null => {
    const suffixes = METRO_SOURCE_EXTENSIONS.flatMap((extension) => [
      `.${name}${extension}`,
      ...(preferNative ? [`.native${extension}`] : []),
      extension,
    ]);
    const sourceFile = (prefix: string): string | undefined =>
      suffixes.map((suffix) => prefix + suffix).find(isFile);
    return (isFile(base) ? base : (sourceFile(base) ?? sourceFile(`${base}/index`))) ?? null;
  };
