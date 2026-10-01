#!/bin/sh
set -eu

. "$(dirname -- "$0")/lib.sh"

guard

[ -n "${SERVICE:-}" ] || stop "SERVICE is not set in $CONF."

gc run services delete "$SERVICE" --region "$REGION"
