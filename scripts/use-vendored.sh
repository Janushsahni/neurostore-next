#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -d vendor ]]; then
  echo "vendor/ not found. Run scripts/bootstrap-online.sh first." >&2
  exit 1
fi

cp .cargo/config.vendored.toml .cargo/config.toml

echo "Switched Cargo config to vendored dependencies."
