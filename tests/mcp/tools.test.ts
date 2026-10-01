import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { explainTool, recommendTool, scanTool } from '../../src/mcp/tools.js';
import { callTool, createServer, runTool } from '../../src/mcp/server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => path.join(here, '..', 'fixtures', name);
const auto = fixture('cli-auto');
const multiApp = fixture('multi-app');

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe('mcp tools', () => {
  it('scanTool reports the families a repo follows', () => {
    const apps = scanTool(auto);
    expect(apps).toHaveLength(1);
    expect(apps[0]!.app).toBe('.');
    expect(apps[0]!.rules.some((rule) => rule.family === 'forbidden-imports')).toBe(true);
  });

  it('scanTool discovers every app under a monorepo root', () => {
    const apps = scanTool(multiApp);
    expect(apps.map((a) => a.app).sort()).toEqual(['app-a', 'app-b']);
  });

  it('scanTool expands the apps under a monorepo root that has its own tsconfig', () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'archprint-mcp-'));
    tmpDirs.push(tmp);
    cpSync(multiApp, tmp, { recursive: true });
    writeFileSync(path.join(tmp, 'tsconfig.json'), '{}\n');
    const apps = scanTool(tmp);
    expect(apps.map((a) => a.app).sort()).toEqual(['app-a', 'app-b']);
  });

  it('recommendTool returns the three tiers', () => {
    const apps = recommendTool(auto);
    expect(apps).toHaveLength(1);
    expect(Array.isArray(apps[0]!.enforceNow)).toBe(true);
    expect(Array.isArray(apps[0]!.review)).toBe(true);
    expect(Array.isArray(apps[0]!.adopt)).toBe(true);
  });

  it('explainTool returns the gate evidence for a known rule', () => {
    const result = explainTool('AP-002', auto);
    expect(result.rule.label).toBe('AP-002');
    expect(result.rule.statement).toBe(result.pattern?.description);
    expect(result.pattern?.gate).toBeDefined();
  });

  it('explainTool explains a family rule and names every file that breaks it', () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'archprint-mcp-'));
    tmpDirs.push(tmp);
    cpSync(auto, tmp, { recursive: true });
    writeFileSync(path.join(tmp, 'lib', 'flag.ts'), 'export const flag = process.env.FLAG;\n');
    const result = explainTool('env-access', tmp);
    expect(result.rule.statement).toBe('read process.env only in the config layer');
    expect(result.rule.exceptions).toEqual(['lib/flag.ts']);
    expect(result.pattern).toBeUndefined();
  });

  it('explainTool throws for an unknown rule id and lists the rules it found', () => {
    expect(() => explainTool('AP-999', auto)).toThrow(/No rule "AP-999".*Rules found: .*AP-002/);
  });

  it('scanTool throws when there is no tsconfig and no discoverable app', () => {
    expect(() => scanTool(here)).toThrow(/No tsconfig/);
  });
});

describe('mcp runTool dispatch', () => {
  it('routes archprint_scan (path defaults to ".")', () => {
    const result = runTool('archprint_scan', { path: auto }) as { apps: unknown[] };
    expect(result.apps).toHaveLength(1);
  });

  it('routes archprint_recommend', () => {
    const result = runTool('archprint_recommend', { path: auto }) as { apps: unknown[] };
    expect(result.apps).toHaveLength(1);
  });

  it('routes archprint_explain and requires an id', () => {
    expect(
      (runTool('archprint_explain', { id: 'AP-002', path: auto }) as { rule: { label: string } })
        .rule.label,
    ).toBe('AP-002');
    expect(() => runTool('archprint_explain', { path: auto })).toThrow(/requires an "id"/);
  });

  it('throws on an unknown tool', () => {
    expect(() => runTool('nope', {})).toThrow(/Unknown tool/);
  });
});

describe('mcp callTool response wrapping', () => {
  it('wraps a successful result as JSON text content', () => {
    const response = callTool('archprint_scan', { path: auto });
    expect(response.isError).toBeUndefined();
    expect(response.content[0]!.type).toBe('text');
    expect(JSON.parse(response.content[0]!.text).apps).toHaveLength(1);
  });

  it('wraps an error as isError text content instead of throwing', () => {
    const response = callTool('archprint_explain', { path: auto });
    expect(response.isError).toBe(true);
    expect(response.content[0]!.text).toContain('requires an "id"');
  });
});

describe('mcp server over an in-memory transport', () => {
  async function connect(): Promise<Client> {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([
      client.connect(clientTransport),
      createServer('9.9.9').connect(serverTransport),
    ]);
    return client;
  }

  it('lists the three read-only tools', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'archprint_explain',
      'archprint_recommend',
      'archprint_scan',
    ]);
    await client.close();
  });

  it('runs archprint_scan and returns its JSON result', async () => {
    const client = await connect();
    const result = (await client.callTool({
      name: 'archprint_scan',
      arguments: { path: auto },
    })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]!.text).apps).toHaveLength(1);
    await client.close();
  });

  it('surfaces a scan failure as an error result rather than throwing', async () => {
    const client = await connect();
    const result = (await client.callTool({
      name: 'archprint_scan',
      arguments: { path: here },
    })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('No tsconfig');
    await client.close();
  });

  it('reports an unknown tool name as an error result rather than throwing', async () => {
    const client = await connect();
    const result = (await client.callTool({ name: 'nope', arguments: {} })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Unknown tool');
    await client.close();
  });
});
