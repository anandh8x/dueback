#!/usr/bin/env bash

set -euo pipefail

read -r -s -p "Enter the Arc Testnet deployer keystore password: " DUEBACK_KEYSTORE_PASSWORD
printf "\n"

DUEBACK_PASSWORD_FILE="$(mktemp /tmp/dueback-deploy-password.XXXXXX)"
chmod 600 "$DUEBACK_PASSWORD_FILE"
printf "%s" "$DUEBACK_KEYSTORE_PASSWORD" >"$DUEBACK_PASSWORD_FILE"
export DUEBACK_PASSWORD_FILE
unset DUEBACK_KEYSTORE_PASSWORD

cleanup() {
  rm -f "$DUEBACK_PASSWORD_FILE"
  unset DUEBACK_PASSWORD_FILE
}
trap cleanup EXIT

node scripts/deploy-arc-testnet.mjs
