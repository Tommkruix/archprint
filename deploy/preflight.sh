#!/bin/sh
# Answers which account this would run as, before anything can act or fail.
set -eu

. "$(dirname -- "$0")/lib.sh"

guard

echo "deploy: ready as $ACCOUNT on project $PROJECT in $REGION."
