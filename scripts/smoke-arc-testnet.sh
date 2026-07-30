#!/usr/bin/env bash

set -euo pipefail

if [[ ! -f deployments/arc-testnet.json ]]; then
  echo "Deploy DueBack before running the Arc Testnet smoke test." >&2
  exit 1
fi

read -r -s -p "Enter the Arc Testnet deployer keystore password: " DUEBACK_KEYSTORE_PASSWORD
printf "\n"

DUEBACK_PASSWORD_FILE="$(mktemp /tmp/dueback-smoke-password.XXXXXX)"
chmod 600 "$DUEBACK_PASSWORD_FILE"
printf "%s" "$DUEBACK_KEYSTORE_PASSWORD" >"$DUEBACK_PASSWORD_FILE"
export DUEBACK_PASSWORD_FILE
unset DUEBACK_KEYSTORE_PASSWORD

cleanup() {
  rm -f "$DUEBACK_PASSWORD_FILE"
  unset DUEBACK_PASSWORD_FILE
}
trap cleanup EXIT

node scripts/smoke-arc-testnet.mjs
