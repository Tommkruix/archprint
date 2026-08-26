export { buildWorkspaceMap } from './scanner/workspace-resolver.js';
export { buildWorkspacePackageMap, findWorkspaceRoot } from './scanner/workspace-packages.js';
export { discoverAppDirs } from './scanner/app-dirs.js';
export {
  classifyFile,
  ROLE_PATTERNS,
  type Role,
  type RoleClassification,
} from './scanner/role-classifier.js';
export { isBarrelFile, resolveToLeafFiles } from './scanner/barrel-resolver.js';
export {
  analyzeImports,
  createImportAnalyzer,
  listSourceFiles,
  walkRepo,
  type EdgeKind,
  type ResolvedImport,
  type WalkedFile,
} from './scanner/file-walker.js';
export {
  detectForbiddenImport,
  detectForbiddenImports,
  detectNoDbInRequestEntry,
  detectDbClientInRequestEntry,
  detectUiLayerInServerEntry,
  DEFAULT_DB_MARKERS,
  REQUEST_ENTRY_ROLES,
  type DetectedPattern,
  type PatternConfig,
  type Violation,
} from './detector/pattern-detector.js';
export {
  inferUiLayerMarkers,
  inferDbClientMarkers,
  KNOWN_DB_LIBRARIES,
  type InferredMarkers,
  type InferredDbMarkers,
  type UiSegmentEvidence,
} from './detector/marker-inference.js';
export {
  detectLayerBoundaries,
  layerOfPath,
  type LayerAnalysis,
  type LayerBoundary,
  type LayerInfo,
  type LayerDetectorOptions,
} from './detector/layer-detector.js';
export {
  detectCycles,
  type CycleAnalysis,
  type CycleDetectorOptions,
  type ImportCycle,
} from './detector/cycle-detector.js';
export {
  detectOrphans,
  type OrphanAnalysis,
  type OrphanDetectorOptions,
} from './detector/orphan-detector.js';
export { buildImportGraph, type ImportGraph } from './scanner/import-graph.js';
export {
  evaluateGate,
  GATE_THRESHOLDS,
  type GateInput,
  type GateResult,
  type GenerationStatus,
} from './detector/confidence-gate.js';
export {
  generateRuleArtifacts,
  emitRuleArtifacts,
  type RuleArtifacts,
} from './generator/rule-generator.js';
export {
  toDependencyCruiser,
  toEslintBoundaries,
  type DependencyCruiserConfig,
  type DependencyCruiserRule,
  type EslintBoundariesConfig,
  type EslintBoundariesElement,
  type EslintBoundariesRule,
} from './generator/layer-emitters.js';
