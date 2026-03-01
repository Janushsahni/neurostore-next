#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "${ROOT_DIR}"

echo "[1/3] Running control-plane API tests"
(
  cd services/control-plane
  node --test test/*.test.mjs
)

echo "[2/3] Running core crypto/erasure tests"
if ! cargo test -p neuro-client-sdk --offline; then
  cargo test -p neuro-client-sdk
fi

echo "[3/3] Validating compose stack configuration"
docker compose -f deploy/docker-compose.yml config > /dev/null

echo "Smoke checks passed"
