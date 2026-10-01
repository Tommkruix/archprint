import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createRemoteHttpServer, type RemoteHttpOptions } from '../../../src/mcp/remote/http.js';
import { createRemoteServer } from '../../../src/mcp/remote/server.js';
import { makeRemoteTools, type RepoRunner } from '../../../src/mcp/remote/tools.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const auto = path.join(here, '..', '..', 'fixtures', 'cli-auto');
const anyRepo = 'https://github.com/owner/repo';

const runsAt =
  (dir: string): RepoRunner =>
  (_spec, _ref, _options, use) =>
    Promise.resolve(use(dir));

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

function start(options: RemoteHttpOptions = {}): Promise<{ url: string; base: string }> {
  const server = createRemoteHttpServer('9.9.9', options);
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}/mcp`, base: `http://127.0.0.1:${port}` });
    });
  });
}

async function withClient(url: string, use: (client: Client) => Promise<void>): Promise<void> {
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  try {
    await use(client);
  } finally {
    await client.close();
  }
}

describe('remote http server', () => {
  it('serves tools/list over an MCP client', async () => {
    const { url } = await start();
    await withClient(url, async (client) => {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        'archprint_explain',
        'archprint_recommend',
        'archprint_scan',
      ]);
    });
  });

  it('runs a scan tool call over HTTP against a cloned working tree', async () => {
    const { url } = await start({
      serverFactory: () => createRemoteServer('9.9.9', makeRemoteTools(runsAt(auto))),
    });
    await withClient(url, async (client) => {
      const result = (await client.callTool({
        name: 'archprint_scan',
        arguments: { repo: anyRepo },
      })) as {
        content: { text: string }[];
      };
      expect(JSON.parse(result.content[0]!.text).apps).toHaveLength(1);
    });
  });

  for (const healthPath of ['/health', '/healthz']) {
    it(`answers the health check at ${healthPath}`, async () => {
      const { base } = await start();
      const response = await fetch(`${base}${healthPath}`);
      expect(response.status).toBe(200);
      expect(((await response.json()) as { status: string }).status).toBe('ok');
    });
  }

  it('404s an unknown path and 405s a GET on the MCP endpoint', async () => {
    const { url, base } = await start();
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    expect((await fetch(url)).status).toBe(405);
  });

  it('rejects requests over the concurrency limit with 429', async () => {
    const { url } = await start({ maxConcurrent: 0 });
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(response.status).toBe(429);
  });

  it('rejects a body over the size limit with 400', async () => {
    const { url } = await start({ maxBodyBytes: 5 });
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain('too large');
  });

  it('releases the concurrency slot when a client disconnects mid-request', async () => {
    let markEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gatedRunner: RepoRunner = async (_spec, _ref, _options, use) => {
      markEntered();
      await gate;
      return use(auto);
    };

    const { url } = await start({
      maxConcurrent: 1,
      serverFactory: () => createRemoteServer('9.9.9', makeRemoteTools(gatedRunner)),
    });

    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    const pending = client
      .callTool({ name: 'archprint_scan', arguments: { repo: anyRepo } })
      .catch(() => undefined);
    await entered;
    await client.close();
    release();
    await pending;

    await expect
      .poll(
        async () => {
          const probe = new Client({ name: 'probe', version: '0.0.0' });
          try {
            await probe.connect(new StreamableHTTPClientTransport(new URL(url)));
            await probe.listTools();
            await probe.close();
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 5000 },
      )
      .toBe(true);
  });

  it('rejects an invalid JSON body with 400', async () => {
    const { url } = await start();
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain('Invalid JSON');
  });
});
