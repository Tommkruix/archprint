# shellcheck shell=sh

DEPLOY_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
GCLOUD="$DEPLOY_DIR/gcloud"
CONF="${ARCHPRINT_CLOUD_CONF:-$DEPLOY_DIR/cloud.conf}"

stop() {
  echo "deploy: $1" >&2
  exit 1
}

[ -x "$GCLOUD" ] || stop "no wrapper at $GCLOUD. Deploy scripts must live in deploy/ and run through it."
[ -f "$CONF" ] || stop "no config at $CONF. Copy deploy/cloud.conf.example to deploy/cloud.conf and fill it in."

# shellcheck disable=SC1090
. "$CONF"

[ -n "${PROJECT:-}" ] || stop "PROJECT is empty in $CONF."
[ -n "${REGION:-}" ] || stop "REGION is empty in $CONF."
[ -n "${ACCOUNT:-}" ] || stop "ACCOUNT is empty in $CONF."

guard() {
  if ! signed_in=$("$GCLOUD" auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null); then
    stop "could not read the active account. Run: $GCLOUD auth login"
  fi
  [ -n "$signed_in" ] || stop "no account is signed in. Run: $GCLOUD auth login"
  [ "$signed_in" = "$ACCOUNT" ] || stop "signed in as $signed_in but the config expects $ACCOUNT. Refusing."
  ARCHPRINT_DEPLOY_GUARDED=1
}

require_guard() {
  [ "${ARCHPRINT_DEPLOY_GUARDED:-}" = "1" ] || stop "a cloud command was attempted before the account guard ran."
}

gc() {
  require_guard
  "$GCLOUD" "$@" --project="$PROJECT"
}

gc_unpinned() {
  require_guard
  "$GCLOUD" "$@"
}
