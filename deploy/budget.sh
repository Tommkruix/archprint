#!/bin/sh
set -eu

. "$(dirname -- "$0")/lib.sh"

guard

[ -n "${BILLING_ACCOUNT:-}" ] || stop "BILLING_ACCOUNT is not set in $CONF."

BUDGET_NAME="archprint any spend"

if gc_unpinned billing budgets list --billing-account="$BILLING_ACCOUNT" \
  --format="value(displayName)" 2>/dev/null | grep -qx "$BUDGET_NAME"; then
  echo "deploy: budget already exists, leaving it alone."
  exit 0
fi

gc_unpinned auth application-default set-quota-project "$PROJECT" >/dev/null 2>&1 ||
  stop "could not set the ADC quota project. Run: $GCLOUD auth application-default login"

project_number=$(gc_unpinned projects describe "$PROJECT" --format="value(projectNumber)")

gc_unpinned billing budgets create \
  --billing-account="$BILLING_ACCOUNT" \
  --display-name="$BUDGET_NAME" \
  --budget-amount=1USD \
  --credit-types-treatment=EXCLUDE_ALL_CREDITS \
  --filter-projects="projects/$project_number" \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=1.0 >/dev/null

echo "deploy: budget created. It alerts, it does not stop spend."
