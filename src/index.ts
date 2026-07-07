export { buildWorkspaceMap } from './scanner/workspace-resolver.js';
export { buildWorkspacePackageMap, findWorkspaceRoot } from './scanner/workspace-packages.js';
export { classifyFile, type Role, type RoleClassification } from './scanner/role-classifier.js';
export { isBarrelFile, resolveToLeafFiles } from './scanner/barrel-resolver.js';
export {
  analyzeImports,
  listSourceFiles,
  walkRepo,
  type EdgeKind,
  type ResolvedImport,
  type WalkedFile,
} from './scanner/file-walker.js';
