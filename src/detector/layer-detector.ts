import * as path from 'node:path';
import {
  createImportAnalyzer,
  type ResolvedImport,
  walkRepo,
  type WalkedFile,
} from '../scanner/file-walker.js';
import { buildWorkspaceMap } from '../scanner/workspace-resolver.js';
import { evaluateGate, type GateResult, type GenerationStatus } from './confidence-gate.js';

const STRUCTURAL_SEGMENTS = new Set([
  'src',
  'app',
  'pages',
  'dist',
  'build',
  'public',
  'test',
  'tests',
  '__tests__',
  'node_modules',
  '.next',
]);

const isStructural = (segment: string): boolean =>
  STRUCTURAL_SEGMENTS.has(segment) ||
  segment.includes('.') ||
  /^\(.*\)$/.test(segment) ||
  /^\[.*\]$/.test(segment) ||
  segment.startsWith('@');

export function layerOfPath(relativePath: string): string | null {
  for (const segment of relativePath.split('/')) {
    if (!isStructural(segment)) return segment;
  }
  return null;
}

interface AliasEntry {
  prefix: string;
  dir: string;
}

const buildAliasEntries = (appDir: string): AliasEntry[] =>
  Object.entries(buildWorkspaceMap(appDir)).map(([key, value]) => ({
    prefix: key.replace(/\/?\*$/, ''),
    dir: path.resolve(appDir, String(value).replace(/\/?\*$/, '')),
  }));

function specifierToLayer(
  specifier: string,
  fileAbsPath: string,
  appDir: string,
  aliases: readonly AliasEntry[],
): string | null {
  let abs: string | null = null;
  if (specifier.startsWith('.')) {
    abs = path.resolve(path.dirname(fileAbsPath), specifier);
  } else {
    for (const { prefix, dir } of aliases) {
      if (specifier === prefix || specifier.startsWith(`${prefix}/`)) {
        abs = path.resolve(dir, specifier.slice(prefix.length).replace(/^\//, ''));
        break;
      }
    }
  }
  if (abs === null) return null;
  const rel = path.relative(appDir, abs).split(path.sep).join('/');
  return rel.startsWith('..') ? null : layerOfPath(rel);
}

function targetLayers(
  imp: ResolvedImport,
  fileAbsPath: string,
  appDir: string,
  aliases: readonly AliasEntry[],
  resolve: boolean,
): string[] {
  if (!resolve) {
    const layer = specifierToLayer(imp.specifier, fileAbsPath, appDir, aliases);
    return layer === null ? [] : [layer];
  }
  const layers: string[] = [];
  for (const leaf of imp.valueLeafPaths) {
    if (leaf.includes('/node_modules/')) continue;
    const rel = path.relative(appDir, leaf).split(path.sep).join('/');
    if (rel.startsWith('..')) continue;
    const layer = layerOfPath(rel);
    if (layer !== null) layers.push(layer);
  }
  return layers;
}

export interface LayerInfo {
  layer: string;
  fileCount: number;
}

export interface LayerBoundary {
  id: string;
  name: string;
  from: string;
  to: string;
  description: string;
  stats: {
    roleFileCount: number;
    conformingFileCount: number;
    violatingFileCount: number;
    ratio: number;
    roleConfidence: number;
  };
  gate: GateResult;
  violations: { file: string; specifier: string }[];
  reverseFlow: number;
}

export interface LayerAnalysis {
  appDir: string;
  layers: LayerInfo[];
  boundaries: LayerBoundary[];
}

export interface LayerDetectorOptions {
  resolve?: boolean;
  minLayerFiles?: number;
}

const STATUS_RANK: Record<GenerationStatus, number> = { AUTO: 0, SUGGEST: 1, REJECT: 2 };

export function detectLayerBoundaries(
  appDir: string,
  options: LayerDetectorOptions = {},
): LayerAnalysis {
  const resolve = options.resolve ?? false;
  const minLayerFiles = options.minLayerFiles ?? 5;

  const root = path.resolve(appDir);
  const files = walkRepo(root).filter((file: WalkedFile) => file.role !== 'TEST');
  const fileLayer = new Map<string, string>();
  const layerFileCount = new Map<string, number>();
  for (const file of files) {
    const layer = layerOfPath(file.relativePath);
    if (layer === null) continue;
    fileLayer.set(file.relativePath, layer);
    layerFileCount.set(layer, (layerFileCount.get(layer) ?? 0) + 1);
  }

  const aliases = buildAliasEntries(root);
  const analyze = createImportAnalyzer(root, { resolve });

  const edges = new Map<string, Map<string, string>>();
  for (const file of files) {
    const from = fileLayer.get(file.relativePath);
    if (from === undefined) continue;
    let imports: ResolvedImport[];
    try {
      imports = analyze(file.absolutePath);
    } catch {
      /* v8 ignore next -- defensive: analyze throws only on an unreadable/malformed source file */
      imports = [];
    }
    for (const imp of imports) {
      if (!imp.hasValueBinding) continue;
      for (const to of targetLayers(imp, file.absolutePath, root, aliases, resolve)) {
        if (to === from) continue;
        const key = `${from}>${to}`;
        let sources = edges.get(key);
        if (sources === undefined) {
          sources = new Map();
          edges.set(key, sources);
        }
        if (!sources.has(file.relativePath)) sources.set(file.relativePath, imp.specifier);
      }
    }
  }

  const edgeSize = (from: string, to: string): number => edges.get(`${from}>${to}`)?.size ?? 0;

  const layers = [...layerFileCount.entries()]
    .filter(([, count]) => count >= minLayerFiles)
    .map(([layer]) => layer)
    .sort();

  const boundaries: LayerBoundary[] = [];
  for (let i = 0; i < layers.length; i += 1) {
    for (let j = i + 1; j < layers.length; j += 1) {
      const a = layers[i]!;
      const b = layers[j]!;
      const ab = edgeSize(a, b);
      const ba = edgeSize(b, a);
      if (ab === 0 && ba === 0) continue;
      const [from, to, violating, reverseFlow] = ab <= ba ? [a, b, ab, ba] : [b, a, ba, ab];
      const roleFileCount = layerFileCount.get(from)!;
      const gate = evaluateGate({
        roleFileCount,
        violatingFileCount: violating,
        roleConfidence: 1,
      });
      const violations = [...(edges.get(`${from}>${to}`)?.entries() ?? [])].map(
        ([file, specifier]) => ({ file, specifier }),
      );
      boundaries.push({
        id: 'AP-LAYER',
        name: `no-import:${from}->${to}`,
        from,
        to,
        description: `Files in the "${from}" layer must not import the "${to}" layer (observed: "${to}" depends on "${from}" across ${reverseFlow} file(s), not the reverse).`,
        stats: {
          roleFileCount,
          conformingFileCount: roleFileCount - violating,
          violatingFileCount: violating,
          ratio: gate.observedConformance,
          roleConfidence: 1,
        },
        gate,
        violations,
        reverseFlow,
      });
    }
  }
  boundaries.sort(
    (x, y) =>
      STATUS_RANK[x.gate.status] - STATUS_RANK[y.gate.status] || y.reverseFlow - x.reverseFlow,
  );

  const layerInfos = [...layerFileCount.entries()]
    .map(([layer, fileCount]) => ({ layer, fileCount }))
    .sort((x, y) => y.fileCount - x.fileCount);

  return { appDir: root, layers: layerInfos, boundaries };
}
