#!/bin/sh
# Refuses the push if a secret from the local config reached a tracked file.
# Scans the tree rather than the diff, so removing a value that already leaked is still possible.
# Only values that can never legitimately appear are checked: the project id and service name are
# guessable from the public package name and do occur in tests.
set -eu

root=$(git rev-parse --show-toplevel)
conf="$root/deploy/cloud.conf"

[ -f "$conf" ] || exit 0

status=0
for key in ACCOUNT BILLING_ACCOUNT; do
  value=$(sed -n "s/^${key}=//p" "$conf" | head -1)
  [ -n "$value" ] || continue
  if git -C "$root" grep -I --cached -qiF -- "$value" 2>/dev/null; then
    echo "refusing to push: $key from deploy/cloud.conf appears in a tracked file." >&2
    git -C "$root" grep -I --cached -liF -- "$value" 2>/dev/null >&2
    status=1
  fi
done

exit $status
