import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectEnforcers } from '../../src/index.js';

describe('detectEnforcers', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'archprint-enforcers-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const pkg = (obj: object): void =>
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify(obj));

  it('detects declared enforcers from package.json', () => {
    pkg({
      devDependencies: { eslint: '*', 'dependency-cruiser': '*', 'eslint-plugin-import': '*' },
    });
    expect(detectEnforcers(dir)).toEqual({
      eslint: true,
      eslintPluginImport: true,
      dependencyCruiser: true,
      biome: false,
    });
  });

  it('accepts eslint-plugin-import-x as the import plugin', () => {
    pkg({ devDependencies: { 'eslint-plugin-import-x': '*' } });
    expect(detectEnforcers(dir).eslintPluginImport).toBe(true);
  });

  it('detects enforcers from config-file presence when not declared', () => {
    pkg({});
    writeFileSync(path.join(dir, 'eslint.config.mjs'), 'export default [];');
    writeFileSync(path.join(dir, '.dependency-cruiser.json'), '{}');
    writeFileSync(path.join(dir, 'biome.json'), '{}');
    const enforcers = detectEnforcers(dir);
    expect(enforcers.eslint).toBe(true);
    expect(enforcers.dependencyCruiser).toBe(true);
    expect(enforcers.biome).toBe(true);
  });

  it('reports nothing for a bare directory and survives a malformed package.json', () => {
    writeFileSync(path.join(dir, 'package.json'), '{ not json');
    expect(detectEnforcers(dir)).toEqual({
      eslint: false,
      eslintPluginImport: false,
      dependencyCruiser: false,
      biome: false,
    });
  });

  it('walks up to the workspace root to find enforcers declared there', () => {
    pkg({ workspaces: ['packages/*'], devDependencies: { eslint: '*' } });
    const app = path.join(dir, 'packages', 'web');
    mkdirSync(app, { recursive: true });
    writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'web' }));
    expect(detectEnforcers(app).eslint).toBe(true);
  });
});
