#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

cat > .cargo/config.toml <<'CFG'
[build]
target-dir = "target"

[net]
retry = 3

[registries.crates-io]
protocol = "sparse"
CFG

echo "Switched Cargo config to crates.io sparse registry."
