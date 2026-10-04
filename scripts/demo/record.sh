#!/bin/sh
set -eu

DEMO_REPO=https://github.com/Tommkruix/archprint-demo.git
DEMO_COMMIT=ea8ea55b7c0456751af90b6ec6c84889cc896efb

DEMO_ASSETS=$(cd "$(dirname -- "$0")" && pwd)
root=$(cd "$DEMO_ASSETS/../.." && pwd)
version=${ARCHPRINT_VERSION:-$(node -p "require('$root/package.json').version")}
claude_profile=${CLAUDE_DEMO_PROFILE:-$HOME/.config/claude-archprint-demo}

DEMO_DIR=$(mktemp -d /tmp/archprint-demo.XXXX)
trap 'rm -rf "$DEMO_DIR"' EXIT
git clone -q "$DEMO_REPO" "$DEMO_DIR"
git -C "$DEMO_DIR" checkout -q "$DEMO_COMMIT"
(cd "$DEMO_DIR" && npm ci --no-audit --no-fund >/dev/null &&
  npm install --no-save --no-audit --no-fund "archprint@$version" >/dev/null)

[ "$#" -gt 0 ] || set -- scan explain enforce claude-code cursor
cd "$root"
for tape in "$@"; do
  git -C "$DEMO_DIR" checkout -q -- .
  git -C "$DEMO_DIR" clean -qfd
  env -i HOME="$HOME" USER="$USER" LOGNAME="${LOGNAME:-$USER}" TMPDIR="${TMPDIR:-/tmp}" \
    PATH="$PATH" LANG=en_US.UTF-8 TERM=xterm-256color \
    DEMO_DIR="$DEMO_DIR" DEMO_ASSETS="$DEMO_ASSETS" CLAUDE_CONFIG_DIR="$claude_profile" \
    vhs "scripts/demo/$tape.tape"
done
