#!/usr/bin/env bash
set -euo pipefail

LABEL="com.neurostore.node"
PLIST_TARGET="/Library/LaunchDaemons/${LABEL}.plist"
CONFIG_PATH="${CONFIG_PATH:-/Library/Application Support/NeuroStore/node-config.json}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this uninstaller as root or with sudo." >&2
  exit 1
fi

launchctl bootout system "${PLIST_TARGET}" >/dev/null 2>&1 || true
rm -f "${PLIST_TARGET}"

echo "Removed ${LABEL} launch daemon."
echo "Config was left in place at ${CONFIG_PATH}."
