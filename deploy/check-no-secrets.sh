#!/bin/sh
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
