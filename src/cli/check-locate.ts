import * as path from 'node:path';
import { importLocations } from '../scanner/file-walker.js';
import { buildAliasEntries } from '../scanner/import-graph.js';
import { resolveFirstPartyImport } from '../scanner/resolve-import.js';
import type { Finding } from './check-evaluate.js';

const toPosix = (value: string): string => value.split(path.sep).join('/');

export function createLineLocator(appDir: string): (finding: Finding) => number | null {
  const aliases = buildAliasEntries(appDir);
  return (finding) => {
    if (finding.kind === 'file') return null;
    const absolute = path.join(appDir, finding.file);
    let locations;
    try {
      locations = importLocations(absolute);
    } catch {
      return null;
    }
    const matches = locations.filter((location) => {
      if (finding.kind === 'specifier') return location.specifier === finding.subject;
      const resolved = resolveFirstPartyImport(location.specifier, absolute, aliases);
      return resolved !== null && toPosix(path.relative(appDir, resolved)) === finding.subject;
    });
    const lines = [...new Set(matches.map((location) => location.line))];
    return lines.length === 1 ? lines[0]! : null;
  };
}
