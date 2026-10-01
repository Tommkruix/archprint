#!/bin/sh
set -eu

. "$(dirname -- "$0")/lib.sh"

guard

echo "deploy: ready as $ACCOUNT on project $PROJECT in $REGION."
