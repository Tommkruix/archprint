import { readFileSync, writeFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const server = JSON.parse(readFileSync('server.json', 'utf8'));

server.name = pkg.mcpName;
server.description = pkg.description;
server.version = pkg.version;
for (const entry of server.packages) {
  if (entry.registryType === 'npm' && entry.identifier === pkg.name) entry.version = pkg.version;
}

writeFileSync('server.json', `${JSON.stringify(server, null, 2)}\n`);
