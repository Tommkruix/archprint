#!/bin/sh
# Answers "which account would this run as" before anything else can act or fail.
set -eu

. "$(dirname -- "$0")/lib.sh"

guard

echo "deploy: ready as $ACCOUNT on project $PROJECT in $REGION."
