import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { explainTool, recommendTool, scanTool } from './tools.js';

export const TOOLS = [
  {
    name: 'archprint_scan',
    description:
      'List the architecture rules this TypeScript repo already follows, with the evidence: which families are AUTO (clears the confidence gate) or SUGGEST (short of it, worth review), how many files conform vs. break each, and the confidence. Read-only. `path` defaults to "." and a monorepo root scans every app.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'app or monorepo-root directory (default ".")' },
        deep: {
          type: 'boolean',
          description: 'resolve imports through barrels and aliases (slower, more accurate)',
        },
      },
    },
  },
  {
    name: 'archprint_recommend',
    description:
      'Recommend an architecture rule set for this repo from its evidence and detected stack: what to enforce now, what to review before enforcing, and what comparable repos commonly adopt that this repo does not yet. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'app or monorepo-root directory (default ".")' },
      },
    },
  },
  {
    name: 'archprint_explain',
    description:
      'Explain the confidence-gate evidence behind one inferred rule id (e.g. AP-002): its gate status, conformance stats, and the files that violate it. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'rule id, e.g. AP-002' },
        path: { type: 'string', description: 'app or monorepo-root directory (default ".")' },
      },
      required: ['id'],
    },
  },
] as const;

export function runTool(name: string, args: Record<string, unknown>): unknown {
  const input = typeof args.path === 'string' ? args.path : '.';
  switch (name) {
    case 'archprint_scan':
      return { apps: scanTool(input, args.deep === true) };
    case 'archprint_recommend':
      return { apps: recommendTool(input) };
    case 'archprint_explain':
      if (typeof args.id !== 'string' || args.id === '') {
        throw new Error('archprint_explain requires an "id" (for example AP-002).');
      }
      return explainTool(args.id, input);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export interface ToolResponse {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

export function callTool(name: string, args: Record<string, unknown>): ToolResponse {
  try {
    return { content: [{ type: 'text', text: JSON.stringify(runTool(name, args), null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text', text: (error as Error).message }], isError: true };
  }
}

export function createServer(version: string): Server {
  const server = new Server({ name: 'archprint', version }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, (request) => {
    const { content, isError } = callTool(request.params.name, request.params.arguments ?? {});
    return { content, isError };
  });
  return server;
}

/* v8 ignore start -- stdio transport glue: connects the tested server to the process stdio */
export async function startMcpServer(version: string): Promise<void> {
  await createServer(version).connect(new StdioServerTransport());
}
/* v8 ignore stop */
