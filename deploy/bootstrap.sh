#!/bin/sh
# Creates the project, links billing and enables the APIs. Idempotent.
set -eu

. "$(dirname -- "$0")/lib.sh"

guard

if gc_unpinned projects describe "$PROJECT" >/dev/null 2>&1; then
  echo "deploy: project already exists."
else
  echo "deploy: creating project."
  gc_unpinned projects create "$PROJECT"
  echo "deploy: project created."
fi

billing=$(gc_unpinned billing projects describe "$PROJECT" --format="value(billingEnabled)" 2>/dev/null || echo '')
case $billing in
  True | true) echo "deploy: billing already linked." ;;
  *)
    [ -n "${BILLING_ACCOUNT:-}" ] || stop "BILLING_ACCOUNT is not set in $CONF; Cloud Run needs billing."
    echo "deploy: linking billing."
    gc_unpinned billing projects link "$PROJECT" --billing-account="$BILLING_ACCOUNT" >/dev/null
    echo "deploy: billing linked."
    ;;
esac

# Without an active project, APIs reached through Application Default Credentials attribute the call
# elsewhere and fail with SERVICE_DISABLED.
gc_unpinned config set project "$PROJECT" >/dev/null 2>&1

for api in run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com billingbudgets.googleapis.com; do
  echo "deploy: enabling $api"
  gc services enable "$api" >/dev/null
done
echo "deploy: APIs enabled."
