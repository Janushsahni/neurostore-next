#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "${ROOT_DIR}"

echo "[1/4] Running control-plane API tests"
(
  cd services/control-plane
  node --test test/*.test.mjs
)

echo "[2/4] Running s3-gateway tests"
(
  cd services/s3-gateway
  node --test test/*.test.mjs
)

echo "[3/4] Running core crypto/erasure tests"
if ! cargo test -p neuro-client-sdk --offline; then
  cargo test -p neuro-client-sdk
fi

echo "[4/4] Validating compose stack configuration"
docker compose -f deploy/docker-compose.option-a.yml config > /dev/null

echo "Option A smoke checks passed"
