#!/bin/sh
set -eu

. "$(dirname -- "$0")/lib.sh"

guard

[ -n "${SERVICE:-}" ] || stop "SERVICE is not set in $CONF."

gc run deploy "$SERVICE" \
  --source "$DEPLOY_DIR" \
  --build-service-account="projects/$PROJECT/serviceAccounts/$BUILD_SERVICE_ACCOUNT" \
  --service-account="$RUNTIME_SERVICE_ACCOUNT" \
  --region "$REGION" \
  --no-allow-unauthenticated \
  --memory 2Gi \
  --cpu 1 \
  --timeout 300 \
  --concurrency 1 \
  --min-instances 0 \
  --max-instances 2
