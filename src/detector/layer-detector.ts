import * as path from 'node:path';
import {
  createImportAnalyzer,
  type ResolvedImport,
  walkRepo,
  type WalkedFile,
} from '../scanner/file-walker.js';
import { buildWorkspaceMap } from '../scanner/workspace-resolver.js';
import { type LayerAlias, layerRootOf, resolveImportPath } from './layer-paths.js';
import {
  evaluateGate,
  type GateResult,
  type GenerationStatus,
  wilsonLowerBound,
} from './confidence-gate.js';

export function layerOfPath(relativePath: string): string | null {
  return layerRootOf(relativePath)?.layer ?? null;
}

/** The tsconfig path aliases and baseUrl folders, each as an app-relative directory. */
export const layerAliases = (appDir: string): LayerAlias[] =>
  Object.entries(buildWorkspaceMap(appDir)).map(([key, value]) => ({
    prefix: key.replace(/\/?\*$/, ''),
    dir: path
      .relative(appDir, path.resolve(appDir, String(value).replace(/\/?\*$/, '')))
      .split(path.sep)
      .join('/'),
  }));

function targetLayers(
  imp: ResolvedImport,
  file: WalkedFile,
  appDir: string,
  aliases: readonly LayerAlias[],
  resolve: boolean,
): string[] {
  if (!resolve) {
    const target = resolveImportPath(file.relativePath, imp.specifier, aliases);
    const layer = target === null ? null : layerOfPath(target);
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

interface LayerPlacement {
  files: WalkedFile[];
  fileLayer: Map<string, string>;
  layerFileCount: Map<string, number>;
  layerDirs: Map<string, Set<string>>;
}

function placeFiles(root: string): LayerPlacement {
  const files = walkRepo(root).filter((file: WalkedFile) => file.role !== 'TEST');
  const fileLayer = new Map<string, string>();
  const layerFileCount = new Map<string, number>();
  const layerDirs = new Map<string, Set<string>>();
  for (const file of files) {
    const placement = layerRootOf(file.relativePath);
    if (placement === null) continue;
    const { layer, dir } = placement;
    fileLayer.set(file.relativePath, layer);
    layerFileCount.set(layer, (layerFileCount.get(layer) ?? 0) + 1);
    layerDirs.set(layer, (layerDirs.get(layer) ?? new Set()).add(dir));
  }
  return { files, fileLayer, layerFileCount, layerDirs };
}

/** For each `from>to` layer pair, the files importing across it and the first specifier that does. */
function collectEdges(
  root: string,
  { files, fileLayer }: LayerPlacement,
  resolve: boolean,
): Map<string, Map<string, string>> {
  const aliases = layerAliases(root);
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
      for (const to of targetLayers(imp, file, root, aliases, resolve)) {
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
  return edges;
}

const edgeList = (
  sources: Map<string, string> | undefined,
): { file: string; specifier: string }[] =>
  [...(sources?.entries() ?? [])].map(([file, specifier]) => ({ file, specifier }));

export type LayerImportLookup = (from: string, to: string) => { file: string; specifier: string }[];

/** Which files in one layer import another, read as written (the way the layer rules enforce). */
export function layerImports(appDir: string): LayerImportLookup {
  const root = path.resolve(appDir);
  const edges = collectEdges(root, placeFiles(root), false);
  return (from, to) => edgeList(edges.get(`${from}>${to}`));
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
  fromDirs: string[];
  toDirs: string[];
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
  const placement = placeFiles(root);
  const { layerFileCount, layerDirs } = placement;
  const dirsOf = (layer: string): string[] => [...layerDirs.get(layer)!].sort();
  const edges = collectEdges(root, placement, resolve);

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
      const directionalConfidence = wilsonLowerBound(reverseFlow, violating + reverseFlow);
      const gate = evaluateGate({
        roleFileCount,
        violatingFileCount: violating,
        roleConfidence: directionalConfidence,
      });
      const violations = edgeList(edges.get(`${from}>${to}`));
      boundaries.push({
        id: 'AP-LAYER',
        name: `no-import:${from}->${to}`,
        from,
        to,
        fromDirs: dirsOf(from),
        toDirs: dirsOf(to),
        description: `Files in the "${from}" layer must not import the "${to}" layer (observed: "${to}" depends on "${from}" across ${reverseFlow} file(s), not the reverse).`,
        stats: {
          roleFileCount,
          conformingFileCount: roleFileCount - violating,
          violatingFileCount: violating,
          ratio: gate.observedConformance,
          roleConfidence: directionalConfidence,
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
