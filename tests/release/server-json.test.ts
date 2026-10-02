import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path.join(root, file), 'utf8')) as Record<string, unknown>;

interface ServerPackage {
  registryType: string;
  identifier: string;
  version: string;
  packageArguments: { type: string; value: string }[];
}

describe('MCP Registry metadata', () => {
  const pkg = read('package.json');
  const server = read('server.json');
  const [npm] = server.packages as ServerPackage[];

  it('names the server exactly as package.json mcpName, which the registry verifies on npm', () => {
    expect(server.name).toBe(pkg.mcpName);
  });

  it('carries the package version, so the registry entry matches the npm release', () => {
    expect(server.version).toBe(pkg.version);
    expect(npm?.version).toBe(pkg.version);
  });

  it('points at this npm package and starts it with the mcp command', () => {
    expect(npm?.registryType).toBe('npm');
    expect(npm?.identifier).toBe(pkg.name);
    expect(npm?.packageArguments).toEqual([{ type: 'positional', value: 'mcp' }]);
  });

  it('reuses the package description within the registry limit of 100 characters', () => {
    expect(server.description).toBe(pkg.description);
    expect((server.description as string).length).toBeLessThanOrEqual(100);
  });
});
