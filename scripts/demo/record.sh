#!/bin/sh
set -eu

DEMO_REPO=https://github.com/Tommkruix/archprint-demo.git
DEMO_COMMIT=de45c3bceecdfe5ea80b480468e754d0827a484d

DEMO_ASSETS=$(cd "$(dirname -- "$0")" && pwd)
root=$(cd "$DEMO_ASSETS/../.." && pwd)
version=${ARCHPRINT_VERSION:-$(node -p "require('$root/package.json').version")}

DEMO_DIR=$(mktemp -d)
trap 'rm -rf "$DEMO_DIR"' EXIT
git clone -q "$DEMO_REPO" "$DEMO_DIR"
git -C "$DEMO_DIR" checkout -q "$DEMO_COMMIT"
(cd "$DEMO_DIR" && npm ci --no-audit --no-fund >/dev/null &&
  npm install --no-save --no-audit --no-fund "archprint@$version" >/dev/null)
export DEMO_DIR DEMO_ASSETS

[ "$#" -gt 0 ] || set -- scan mcp enforce
cd "$root"
for tape in "$@"; do
  git -C "$DEMO_DIR" checkout -q -- .
  git -C "$DEMO_DIR" clean -qfd
  vhs "scripts/demo/$tape.tape"
done
