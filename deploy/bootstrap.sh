#!/bin/sh
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

gc_unpinned config set project "$PROJECT" >/dev/null 2>&1

for api in run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com billingbudgets.googleapis.com iam.googleapis.com; do
  echo "deploy: enabling $api"
  gc services enable "$api" >/dev/null
done
echo "deploy: APIs enabled."

IMAGE_REPOSITORY=cloud-run-source-deploy

if ! gc artifacts repositories describe "$IMAGE_REPOSITORY" --location="$REGION" >/dev/null 2>&1; then
  echo "deploy: creating image repository."
  gc artifacts repositories create "$IMAGE_REPOSITORY" --repository-format=docker --location="$REGION" >/dev/null
fi

policy=$(mktemp)
trap 'rm -f "$policy"' EXIT
cat >"$policy" <<'EOF'
[
  {"name": "keep-latest", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 2}},
  {"name": "delete-older", "action": {"type": "Delete"}, "condition": {"tagState": "any"}}
]
EOF
gc artifacts repositories set-cleanup-policies "$IMAGE_REPOSITORY" \
  --location="$REGION" --policy="$policy" --no-dry-run >/dev/null
echo "deploy: image repository keeps only the two most recent images."

for account in "$BUILD_SERVICE_ACCOUNT" "$RUNTIME_SERVICE_ACCOUNT"; do
  if ! gc iam service-accounts describe "$account" >/dev/null 2>&1; then
    echo "deploy: creating service account ${account%%@*}."
    gc iam service-accounts create "${account%%@*}" >/dev/null
  fi
done

attempt=1
while ! gc_unpinned projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$BUILD_SERVICE_ACCOUNT" \
  --role=roles/run.builder --condition=None >/dev/null 2>&1; do
  [ "$attempt" -lt 6 ] || stop "could not grant the build account Cloud Run Builder after $attempt attempts."
  attempt=$((attempt + 1))
  sleep 10
done
echo "deploy: the build account holds Cloud Run Builder; the runtime account holds no project role."
