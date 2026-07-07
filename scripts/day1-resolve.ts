import { buildWorkspaceMap } from '../src/index.js';

const target = process.argv[2] ?? '/tmp/inbox-zero';
const map = buildWorkspaceMap(target);
const entries = Object.entries(map).sort(([a], [b]) => a.localeCompare(b));

console.log('\nArchprint Day 1 — workspace resolver');
console.log(`Target repo: ${target}`);
console.log(`Aliases resolved: ${entries.length}\n`);

for (const [alias, absolutePath] of entries) {
  console.log(`  ${alias.padEnd(24)} -> ${absolutePath}`);
}

if (entries.length === 0) {
  console.log('  (no tsconfig "paths" found at the repo root)');
}

console.log('');
