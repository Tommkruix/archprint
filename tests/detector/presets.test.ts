import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  detectDbClientInRequestEntry,
  detectNoDbInRequestEntry,
  detectUiLayerInServerEntry,
} from '../../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => path.join(here, '..', 'fixtures', name);

describe('detector presets', () => {
  it('detectUiLayerInServerEntry rejects when no UI layer can be inferred', () => {
    const result = detectUiLayerInServerEntry(fixture('walker'));
    expect(result.inferredUi.markers).toHaveLength(0);
    expect(result.gate.status).toBe('REJECT');
  });

  it('detectUiLayerInServerEntry infers a UI layer when components exist', () => {
    const result = detectUiLayerInServerEntry(fixture('cli-auto'));
    expect(result.inferredUi.segments).toEqual(['components']);
    expect(result.gate.status).toBe('AUTO');
  });

  it('detectDbClientInRequestEntry infers the pg wrapper and reports its gate', () => {
    const result = detectDbClientInRequestEntry(fixture('db-pg'));
    expect(result.inferredDb.wrappers).toContain('@/db/pool');
    expect(result.gate.status).toBe('REJECT');
    expect(result.stats.roleFileCount).toBe(0);
  });

  it('detectNoDbInRequestEntry classifies the request-entry files with the default markers', () => {
    const result = detectNoDbInRequestEntry(fixture('cli-auto'));
    expect(result.name).toBe('no-direct-db-in-request-entry');
    expect(result.stats.roleFileCount).toBe(45);
    expect(Array.isArray(result.violations)).toBe(true);
  });
});
