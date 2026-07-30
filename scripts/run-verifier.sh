#!/usr/bin/env bash

set -euo pipefail

if [[ ! -f .env ]]; then
  echo "Create the ignored .env file before starting the verifier." >&2
  exit 1
fi

set -a
source .env
set +a

read -r -s -p "Enter the Arc Testnet attestor keystore password: " DUEBACK_KEYSTORE_PASSWORD
printf "\n"

DUEBACK_PASSWORD_FILE="$(mktemp /tmp/dueback-verifier-password.XXXXXX)"
chmod 600 "$DUEBACK_PASSWORD_FILE"
printf "%s" "$DUEBACK_KEYSTORE_PASSWORD" >"$DUEBACK_PASSWORD_FILE"
export DUEBACK_PASSWORD_FILE
unset DUEBACK_KEYSTORE_PASSWORD

export DUEBACK_ARC_RPC_URL="${DUEBACK_ARC_RPC_URL:-${VITE_ARC_RPC_URL}}"
export GOCACHE="${GOCACHE:-/tmp/dueback-go-cache}"

cleanup() {
  rm -f "$DUEBACK_PASSWORD_FILE"
  unset DUEBACK_PASSWORD_FILE
}
trap cleanup EXIT

cd services/verifier
go run ./cmd/dueback-verifier
