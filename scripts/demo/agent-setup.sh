#!/bin/sh
set -eu
npx archprint init >/dev/null
npx archprint wire >/dev/null
git add -A
git -c user.name=demo -c user.email=demo@example.invalid commit -qm "Adopt archprint rules"
git update-ref refs/remotes/origin/main HEAD
