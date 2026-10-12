import { readFileSync } from 'node:fs';
import process from 'node:process';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const recorded = [lock.version, lock.packages?.['']?.version].filter(
  (version) => version !== undefined,
);

if (recorded.length === 0 || recorded.some((version) => version !== pkg.version)) {
  process.stderr.write(
    `package-lock.json records version ${recorded.join(' and ') || 'none'}, but package.json is ${pkg.version}. ` +
      'Run: npm install --package-lock-only --ignore-scripts\n',
  );
  process.exitCode = 1;
}
