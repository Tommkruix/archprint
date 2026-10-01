import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import {
  callRemoteTool,
  createRemoteServer,
  REMOTE_TOOLS,
  runRemoteTool,
} from '../../../src/mcp/remote/server.js';
import { makeRemoteTools, type RepoRunner } from '../../../src/mcp/remote/tools.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const auto = path.join(here, '..', '..', 'fixtures', 'cli-auto');
const anyRepo = 'https://github.com/owner/repo';

const runsAt =
  (dir: string): RepoRunner =>
  (_spec, _ref, _options, use) =>
    Promise.resolve(use(dir));
const toolsFor = (dir: string) => makeRemoteTools(runsAt(dir));

describe('remote tools', () => {
  it('validates the URL then scans the cloned working tree', async () => {
    const apps = await toolsFor(auto).remoteScan(anyRepo);
    expect(apps).toHaveLength(1);
    expect(apps[0]!.rules.some((rule) => rule.family === 'forbidden-imports')).toBe(true);
  });

  it('recommends and explains against the cloned working tree', async () => {
    expect(await toolsFor(auto).remoteRecommend(anyRepo)).toHaveLength(1);
    expect((await toolsFor(auto).remoteExplain('AP-002', anyRepo)).rule.label).toBe('AP-002');
  });

  it('rejects an invalid repo URL before cloning', async () => {
    await expect(makeRemoteTools().remoteScan('not a url')).rejects.toThrow(/valid URL/);
  });
});

describe('runRemoteTool dispatch', () => {
  const tools = toolsFor(auto);

  it('routes scan, recommend, and explain', async () => {
    expect(
      ((await runRemoteTool(tools, 'archprint_scan', { repo: anyRepo })) as { apps: unknown[] })
        .apps,
    ).toHaveLength(1);
    expect(
      (
        (await runRemoteTool(tools, 'archprint_recommend', { repo: anyRepo })) as {
          apps: unknown[];
        }
      ).apps,
    ).toHaveLength(1);
    expect(
      (
        (await runRemoteTool(tools, 'archprint_explain', { id: 'AP-002', repo: anyRepo })) as {
          pattern: { id: string };
        }
      ).pattern.id,
    ).toBe('AP-002');
  });

  it('requires a repo, requires an id for explain, and rejects an unknown tool', async () => {
    await expect(runRemoteTool(tools, 'archprint_scan', {})).rejects.toThrow(/requires a "repo"/);
    await expect(runRemoteTool(tools, 'archprint_scan', { repo: '   ' })).rejects.toThrow(
      /requires a "repo"/,
    );
    await expect(runRemoteTool(tools, 'archprint_explain', { repo: anyRepo })).rejects.toThrow(
      /requires an "id"/,
    );
    await expect(runRemoteTool(tools, 'nope', { repo: anyRepo })).rejects.toThrow(/Unknown tool/);
  });
});

describe('callRemoteTool response wrapping', () => {
  const tools = toolsFor(auto);

  it('wraps success as JSON and failure as an isError result', async () => {
    const good = await callRemoteTool(tools, 'archprint_scan', { repo: anyRepo });
    expect(good.isError).toBeUndefined();
    expect(JSON.parse(good.content[0]!.text).apps).toHaveLength(1);

    const bad = await callRemoteTool(tools, 'archprint_scan', {});
    expect(bad.isError).toBe(true);
    expect(bad.content[0]!.text).toContain('requires a "repo"');
  });
});

describe('remote server descriptors', () => {
  it('requires repo (and id for explain) in the schema', () => {
    const byName = Object.fromEntries(REMOTE_TOOLS.map((tool) => [tool.name, tool]));
    expect(byName.archprint_scan!.inputSchema.required).toEqual(['repo']);
    expect(byName.archprint_explain!.inputSchema.required).toEqual(['id', 'repo']);
  });
});

describe('remote server over an in-memory transport', () => {
  async function connect(dir = auto): Promise<Client> {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([
      client.connect(clientTransport),
      createRemoteServer('9.9.9', toolsFor(dir)).connect(serverTransport),
    ]);
    return client;
  }

  it('lists the three remote tools (default tools wiring)', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([
      client.connect(clientTransport),
      createRemoteServer('9.9.9').connect(serverTransport),
    ]);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'archprint_explain',
      'archprint_recommend',
      'archprint_scan',
    ]);
    await client.close();
  });

  it('runs a scan call and returns its JSON result', async () => {
    const client = await connect();
    const result = (await client.callTool({
      name: 'archprint_scan',
      arguments: { repo: anyRepo },
    })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]!.text).apps).toHaveLength(1);
    await client.close();
  });

  it('returns a missing-repo call as an error result', async () => {
    const client = await connect();
    const result = (await client.callTool({ name: 'archprint_scan', arguments: {} })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('requires a "repo"');
    await client.close();
  });
});
