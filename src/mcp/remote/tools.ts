import {
  explainTool,
  recommendTool,
  scanTool,
  type AppRecommendations,
  type AppScan,
  type ExplainResult,
} from '../tools.js';
import { withClonedRepo, type CloneOptions } from './clone.js';
import { normalizeRef, parseRepoUrl, type RepoSpec } from './repo-url.js';

export type RepoRunner = <T>(
  spec: RepoSpec,
  ref: string | undefined,
  options: CloneOptions,
  use: (dir: string) => T,
) => Promise<T>;

export interface RemoteTools {
  remoteScan(repo: string, ref?: string, deep?: boolean): Promise<AppScan[]>;
  remoteRecommend(repo: string, ref?: string): Promise<AppRecommendations[]>;
  remoteExplain(id: string, repo: string, ref?: string): Promise<ExplainResult>;
}

export function makeRemoteTools(
  run: RepoRunner = withClonedRepo,
  options: CloneOptions = {},
): RemoteTools {
  const inRepo = async <T>(
    repo: string,
    ref: string | undefined,
    use: (dir: string) => T,
  ): Promise<T> => run(parseRepoUrl(repo), normalizeRef(ref), options, use);
  return {
    remoteScan: (repo, ref, deep = false) => inRepo(repo, ref, (dir) => scanTool(dir, deep)),
    remoteRecommend: (repo, ref) => inRepo(repo, ref, (dir) => recommendTool(dir)),
    remoteExplain: (id, repo, ref) => inRepo(repo, ref, (dir) => explainTool(id, dir)),
  };
}
