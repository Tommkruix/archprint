import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { checkTool, explainTool, recommendTool, scanTool } from './tools.js';
import { errorResponse, okResponse, type ToolResponse } from './tool-response.js';

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export const TOOLS = [
  {
    name: 'archprint_scan',
    title: 'Scan architecture rules',
    annotations: READ_ONLY,
    description:
      'List the architecture rules this TypeScript repo already follows, with the evidence: each rule stated in plain words, whether it is AUTO (clears the confidence gate) or SUGGEST (short of it), its adoption ("enforce": archprint init or generate writes a rule for it, which archprint wire connects to the linter, and public-API rules need dependency-cruiser; "review": held for a human to review, not enforced by default; "report-only": the code follows it but archprint writes no rule for it), how many files conform vs. break it, the files that break it, and the confidence. Read-only. `path` defaults to "." and a monorepo root scans every app.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'app or monorepo-root directory on this machine (default "."), not a URL',
        },
        deep: {
          type: 'boolean',
          description: 'resolve imports through barrels and aliases (slower, more accurate)',
        },
      },
    },
  },
  {
    name: 'archprint_recommend',
    title: 'Recommend architecture rules',
    annotations: READ_ONLY,
    description:
      'Recommend an architecture rule set for this repo from its evidence and detected stack: what to enforce now, what the code already follows that archprint reports but does not write a rule for yet (reportOnly), what to review before enforcing, and what comparable repos commonly adopt that this repo does not yet. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'app or monorepo-root directory on this machine (default "."), not a URL',
        },
      },
    },
  },
  {
    name: 'archprint_explain',
    title: 'Explain an architecture rule',
    annotations: READ_ONLY,
    description:
      'Explain one rule from archprint_scan in depth, by its label (e.g. AP-002, env-access, or "lib !-> app"): its statement, gate status, adoption (enforce, review, or report-only, as in archprint_scan), observed conformance and confidence floor, and every file that breaks it (scan lists only a few). For the forbidden-import rules (AP-001, AP-002) it also returns each confidence-gate condition with its value and threshold, how to fix a violation, and when not to adopt the rule. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'rule label from archprint_scan, e.g. AP-002 or env-access',
        },
        path: {
          type: 'string',
          description: 'app or monorepo-root directory on this machine (default "."), not a URL',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'archprint_check',
    title: 'Check a change against adopted rules',
    annotations: READ_ONLY,
    description:
      'Check the current change, including uncommitted edits, against the rules this repo adopted with archprint init or generate, and report only the violations the change introduces (file, line, rule, and the evidence for the rule), plus those it fixed and any exceptions allowed with a reason in .archprint/allow.json. Use it before finishing a change. Compares with `base` (a branch or commit, default origin/HEAD). Read-only: the files of the base commit are copied to a temporary folder outside the repo and deleted afterwards; it runs no git hooks and changes nothing in the repo. Returns status "skipped" with the reason when the repo has not adopted rules.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'repository directory where archprint was set up, on this machine (default ".")',
        },
        base: {
          type: 'string',
          description: 'branch or commit to compare against (default origin/HEAD)',
        },
      },
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
    case 'archprint_check':
      if (args.base !== undefined && typeof args.base !== 'string') {
        throw new Error('archprint_check "base" must be a branch or commit name.');
      }
      return checkTool(input, args.base);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export type { ToolResponse };

export function callTool(name: string, args: Record<string, unknown>): ToolResponse {
  try {
    return okResponse(runTool(name, args));
  } catch (error) {
    return errorResponse(error);
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
