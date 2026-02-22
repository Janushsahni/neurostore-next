#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[1/5] Generating lockfile"
cargo generate-lockfile

echo "[2/5] Fetching dependencies"
cargo fetch

echo "[3/5] Vendoring dependencies"
rm -rf vendor
cargo vendor vendor >/dev/null

echo "[4/5] Activating vendored cargo config"
cp .cargo/config.vendored.toml .cargo/config.toml

echo "[5/5] Running baseline checks"
cargo check --locked

cat <<MSG
Online bootstrap complete.
- Dependencies vendored in ./vendor
- Cargo configured for vendored sources in .cargo/config.toml
For offline checks, run: scripts/build-offline.sh
MSG
