export { buildWorkspaceMap } from './scanner/workspace-resolver.js';
export { buildWorkspacePackageMap, findWorkspaceRoot } from './scanner/workspace-packages.js';
export { classifyFile, type Role, type RoleClassification } from './scanner/role-classifier.js';
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
  detectNoDbInRequestEntry,
  DEFAULT_DB_MARKERS,
  REQUEST_ENTRY_ROLES,
  type DetectedPattern,
  type PatternConfig,
  type Violation,
} from './detector/pattern-detector.js';
export {
  evaluateGate,
  GATE_THRESHOLDS,
  type GateInput,
  type GateResult,
  type GenerationStatus,
} from './detector/confidence-gate.js';
