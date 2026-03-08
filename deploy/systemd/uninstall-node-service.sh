#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="neuro-node"
UNIT_TARGET="/etc/systemd/system/${SERVICE_NAME}.service"
CONFIG_PATH="${CONFIG_PATH:-/etc/neurostore/node-config.json}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this uninstaller as root or with sudo." >&2
  exit 1
fi

if systemctl list-unit-files | grep -q "^${SERVICE_NAME}\.service"; then
  systemctl stop "${SERVICE_NAME}" || true
  systemctl disable "${SERVICE_NAME}" || true
fi

rm -f "${UNIT_TARGET}"
systemctl daemon-reload

echo "Removed ${SERVICE_NAME} service unit."
echo "Config was left in place at ${CONFIG_PATH}."
