#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHELL_DIR="$ROOT_DIR/apps/tauri-shell"

if [[ ! -d "$SHELL_DIR" ]]; then
  echo "apps/tauri-shell not found" >&2
  exit 1
fi

cd "$SHELL_DIR"

TARGET="${1:-desktop}"

case "$TARGET" in
  desktop)
    npm run build
    ;;
  ios)
    npm run ios:build
    ;;
  android)
    npm run android:build
    ;;
  all)
    npm run build
    npm run ios:build
    npm run android:build
    ;;
  *)
    echo "Usage: $0 [desktop|ios|android|all]" >&2
    exit 1
    ;;
esac
