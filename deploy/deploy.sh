#!/bin/sh
set -eu

. "$(dirname -- "$0")/lib.sh"

guard

[ -n "${SERVICE:-}" ] || stop "SERVICE is not set in $CONF."

gc run deploy "$SERVICE" \
  --source "$DEPLOY_DIR" \
  --region "$REGION" \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 1 \
  --timeout 300 \
  --concurrency 4 \
  --min-instances 0 \
  --max-instances 2
