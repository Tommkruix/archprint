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
export {
  buildImportGraph,
  stronglyConnectedComponents,
  type ImportGraph,
  type ImportGraphOptions,
} from './scanner/import-graph.js';
export {
  computeLayerReachability,
  reachesLayer,
  type ReachabilityAnalysis,
  type ReachabilityOptions,
} from './detector/reachability.js';
export {
  detectPublicApiBoundaries,
  type PublicApiAnalysis,
  type PublicApiGroup,
  type PublicApiViolation,
  type PublicApiDetectorOptions,
} from './detector/public-api-detector.js';
export {
  detectFeatureSliceIsolation,
  type FeatureSliceAnalysis,
  type FeatureSliceGroup,
  type FeatureSliceViolation,
  type FeatureSliceDetectorOptions,
} from './detector/feature-slice-detector.js';
export {
  detectTestIsolation,
  type TestIsolationAnalysis,
  type TestImportViolation,
  type TestIsolationDetectorOptions,
} from './detector/test-isolation-detector.js';
export {
  detectAppIsolation,
  type AppIsolationAnalysis,
  type AppIsolationGroup,
  type AppImportViolation,
  type AppIsolationDetectorOptions,
} from './detector/app-isolation-detector.js';
export {
  detectSiblingIsolation,
  type SiblingGroup,
  type SiblingViolation,
  type SiblingIsolationOptions,
} from './detector/sibling-isolation.js';
export {
  detectDependencyInternals,
  type DependencyInternalsAnalysis,
  type DependencyInternalViolation,
  type DependencyInternalsOptions,
} from './detector/dependency-internals-detector.js';
export {
  detectRoleLayering,
  type RoleLayeringAnalysis,
  type RoleBoundary,
  type RoleBoundaryViolation,
  type RoleLayeringOptions,
} from './detector/role-layering-detector.js';
export {
  detectEntryPurity,
  type EntryPurityAnalysis,
  type EntryImportViolation,
  type EntryPurityOptions,
} from './detector/entry-purity-detector.js';
export {
  detectPhantomDependencies,
  type PhantomDependencyAnalysis,
  type PhantomDependencyViolation,
  type PhantomDependencyOptions,
} from './detector/phantom-dependency-detector.js';
export {
  detectDeepRelativeImports,
  type DeepRelativeAnalysis,
  type DeepRelativeViolation,
  type DeepRelativeOptions,
} from './detector/deep-relative-detector.js';
export {
  detectConsoleIsolation,
  type ConsoleIsolationAnalysis,
  type ConsoleUsageViolation,
  type ConsoleIsolationOptions,
} from './detector/console-isolation-detector.js';
export {
  detectEnvAccess,
  type EnvAccessAnalysis,
  type EnvAccessViolation,
  type EnvAccessOptions,
} from './detector/env-access-detector.js';
export { scanUsage, type UsageScan, type FileUsage } from './scanner/usage-scanner.js';
export {
  detectWorkspacePackageApi,
  type WorkspacePackageAnalysis,
  type WorkspacePackageViolation,
  type WorkspacePackageOptions,
} from './detector/workspace-package-detector.js';
export {
  detectStoriesIsolation,
  type StoriesIsolationAnalysis,
  type StoryImportViolation,
  type StoriesIsolationOptions,
} from './detector/stories-isolation-detector.js';
export {
  detectUiDataIsolation,
  type UiDataIsolationAnalysis,
  type UiDataViolation,
  type UiDataIsolationOptions,
} from './detector/ui-data-isolation-detector.js';
export {
  detectServerClientBoundary,
  type ServerClientAnalysis,
  type ServerClientViolation,
  type ServerClientOptions,
} from './detector/server-client-detector.js';
export {
  evaluateGate,
  GATE_THRESHOLDS,
  type GateInput,
  type GateResult,
  type GenerationStatus,
} from './detector/confidence-gate.js';
export { checkSelfConsistency, type ConsistencyIssue } from './detector/self-consistency.js';
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
export {
  toMermaid,
  toGraphviz,
  layerGraphEdges,
  type LayerGraphEdge,
} from './generator/graph-emitters.js';
export {
  toDependencyCruiserPublicApi,
  type DeepImportConfig,
  type DeepImportRule,
} from './generator/public-api-emitters.js';
export {
  toDependencyCruiserFeatureSlice,
  type CrossSliceConfig,
  type CrossSliceRule,
} from './generator/feature-slice-emitters.js';
export {
  toDependencyCruiserTestIsolation,
  type NotToTestConfig,
  type NotToTestRule,
} from './generator/test-isolation-emitters.js';
export {
  toDependencyCruiserAppIsolation,
  type CrossAppConfig,
  type CrossAppRule,
} from './generator/app-isolation-emitters.js';
export {
  toDependencyCruiserDependencyInternals,
  type NoInternalsConfig,
  type NoInternalsRule,
} from './generator/dependency-internals-emitters.js';
export {
  toDependencyCruiserRoleLayering,
  type RoleLayeringConfig,
  type RoleLayeringRule,
} from './generator/role-layering-emitters.js';
export {
  toDependencyCruiserEntryPurity,
  type EntryPurityConfig,
  type EntryPurityRule,
} from './generator/entry-purity-emitters.js';
export {
  toDependencyCruiserPhantomDependencies,
  type PhantomDependencyConfig,
  type PhantomDependencyRule,
} from './generator/phantom-dependency-emitters.js';
export {
  toEslintDeepRelative,
  type EslintNoRestrictedImportsConfig,
  type NoRestrictedImportsPattern,
} from './generator/deep-relative-emitters.js';
export {
  toEslintConsoleIsolation,
  type EslintFlatConfigBlock,
} from './generator/console-isolation-emitters.js';
export { toEslintEnvAccess } from './generator/env-access-emitters.js';
export { toEslintWorkspacePackageApi } from './generator/workspace-package-emitters.js';
export {
  toDependencyCruiserStoriesIsolation,
  type StoriesIsolationConfig,
  type StoriesIsolationRule,
} from './generator/stories-isolation-emitters.js';
export {
  toDependencyCruiserUiData,
  type UiDataConfig,
  type UiDataRule,
} from './generator/ui-data-isolation-emitters.js';
export {
  toDependencyCruiserServerClient,
  type ServerClientConfig,
  type ServerClientRule,
} from './generator/server-client-emitters.js';
export { hasUseServerDirective, hasUseClientDirective } from './scanner/role-classifier.js';
