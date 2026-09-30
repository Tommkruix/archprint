import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { errorResponse, okResponse, type ToolResponse } from '../tool-response.js';
import { makeRemoteTools, type RemoteTools } from './tools.js';

const repoProperty = {
  repo: {
    type: 'string',
    description: 'https URL of a public repository on github.com, gitlab.com, or bitbucket.org',
  },
  ref: {
    type: 'string',
    description: 'branch or tag to scan (optional; defaults to the repo default branch)',
  },
} as const;

export const REMOTE_TOOLS = [
  {
    name: 'archprint_scan',
    description:
      'Clone a public repository by URL (read-only, ephemeral) and list the architecture rules it already follows, with the evidence: which families are AUTO (clears the confidence gate) or SUGGEST (worth review), how many files conform vs. break each, and the confidence.',
    inputSchema: {
      type: 'object',
      properties: {
        ...repoProperty,
        deep: {
          type: 'boolean',
          description: 'resolve imports through barrels and aliases (slower, more accurate)',
        },
      },
      required: ['repo'],
    },
  },
  {
    name: 'archprint_recommend',
    description:
      'Clone a public repository by URL (read-only, ephemeral) and recommend an architecture rule set from its evidence and stack: what to enforce now, what to review before enforcing, and what comparable repos commonly adopt that this one does not yet.',
    inputSchema: { type: 'object', properties: { ...repoProperty }, required: ['repo'] },
  },
  {
    name: 'archprint_explain',
    description:
      'Clone a public repository by URL (read-only, ephemeral) and explain the confidence-gate evidence behind one inferred rule id (e.g. AP-002): its gate status, conformance stats, and the files that violate it.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'rule id, e.g. AP-002' }, ...repoProperty },
      required: ['id', 'repo'],
    },
  },
] as const;

export async function runRemoteTool(
  tools: RemoteTools,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const repo = typeof args.repo === 'string' ? args.repo.trim() : '';
  if (repo === '') {
    throw new Error(`${name} requires a "repo" URL (for example https://github.com/owner/repo).`);
  }
  const ref = typeof args.ref === 'string' ? args.ref : undefined;
  switch (name) {
    case 'archprint_scan':
      return { apps: await tools.remoteScan(repo, ref, args.deep === true) };
    case 'archprint_recommend':
      return { apps: await tools.remoteRecommend(repo, ref) };
    case 'archprint_explain':
      if (typeof args.id !== 'string' || args.id === '') {
        throw new Error('archprint_explain requires an "id" (for example AP-002).');
      }
      return tools.remoteExplain(args.id, repo, ref);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export async function callRemoteTool(
  tools: RemoteTools,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  try {
    return okResponse(await runRemoteTool(tools, name, args));
  } catch (error) {
    return errorResponse(error);
  }
}

export function createRemoteServer(
  version: string,
  tools: RemoteTools = makeRemoteTools(),
): Server {
  const server = new Server({ name: 'archprint-remote', version }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: REMOTE_TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { content, isError } = await callRemoteTool(
      tools,
      request.params.name,
      request.params.arguments ?? {},
    );
    return { content, isError };
  });
  return server;
}
