#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="neuro-node"
SERVICE_USER="neurostore"
SERVICE_GROUP="neurostore"
BINARY_PATH="${BINARY_PATH:-/usr/local/bin/neuro-node}"
CONFIG_PATH="${CONFIG_PATH:-/etc/neurostore/node-config.json}"
STORAGE_PATH="${STORAGE_PATH:-/var/lib/neurostore/node-data}"
WORKDIR="${WORKDIR:-/var/lib/neurostore}"
RELAY_URL="${RELAY_URL:-wss://neurostore-backend-production.up.railway.app/v1/nodes/ws}"
GATEWAY_URL="${GATEWAY_URL:-https://neurostore-backend-production.up.railway.app}"
NODE_SECRET="${NODE_SECRET:-${NEUROSTORE_NODE_SHARED_SECRET:-${NODE_SHARED_SECRET:-}}}"
WALLET_ADDRESS="${WALLET_ADDRESS:-0x0000000000000000000000000000000000000000}"
DECLARED_LOCATION="${DECLARED_LOCATION:-IN}"
INGRESS_PORT="${INGRESS_PORT:-9184}"
PUBLIC_INGRESS_URL="${PUBLIC_INGRESS_URL:-}"
FRONTEND_URL="${FRONTEND_URL:-https://neurostore.vercel.app}"
MAX_GB="${MAX_GB:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIT_SOURCE="${SCRIPT_DIR}/neuro-node.service"
UNIT_TARGET="/etc/systemd/system/${SERVICE_NAME}.service"

derive_node_id() {
  local peer_id
  peer_id="$("${BINARY_PATH}" --setup-config-path "${CONFIG_PATH}" --print-peer-id 2>/dev/null || true)"
  peer_id="$(printf '%s' "${peer_id}" | tr -d '\r\n')"
  if [[ ${#peer_id} -lt 8 ]]; then
    return 1
  fi
  local peer_len="${#peer_id}"
  local start=$(( peer_len > 8 ? peer_len - 8 : 0 ))
  printf 'NEURO-%s\n' "${peer_id:${start}}" | tr '[:lower:]' '[:upper:]'
}

copy_to_clipboard() {
  local value="$1"
  if command -v wl-copy >/dev/null 2>&1; then
    printf '%s' "${value}" | wl-copy
  elif command -v xclip >/dev/null 2>&1; then
    printf '%s' "${value}" | xclip -selection clipboard
  elif command -v xsel >/dev/null 2>&1; then
    printf '%s' "${value}" | xsel --clipboard --input
  fi
}

open_dashboard() {
  local node_id="$1"
  local dashboard_url="${FRONTEND_URL%/}/dashboard/node?node_id=${node_id}"
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "${dashboard_url}" >/dev/null 2>&1 || true
  fi
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "Run this installer as root or with sudo." >&2
    exit 1
  fi
}

prompt_default() {
  local label="$1"
  local current="$2"
  local input
  read -r -p "${label} [${current}]: " input
  if [[ -z "${input}" ]]; then
    printf '%s\n' "${current}"
  else
    printf '%s\n' "${input}"
  fi
}

write_config() {
  local config_dir
  local node_secret_json="null"
  config_dir="$(dirname "${CONFIG_PATH}")"
  mkdir -p "${config_dir}" "${WORKDIR}" "${STORAGE_PATH}"
  chown -R "${SERVICE_USER}:${SERVICE_GROUP}" "${WORKDIR}"
  if [[ -n "${NODE_SECRET}" ]]; then
    node_secret_json="\"${NODE_SECRET}\""
  fi

  cat > "${CONFIG_PATH}" <<EOF
{
  "storage_path": "${STORAGE_PATH}",
  "max_gb": ${MAX_GB},
  "relay_url": "${RELAY_URL}",
  "gateway_url": "${GATEWAY_URL}",
  "node_secret": ${node_secret_json},
  "ingress_port": ${INGRESS_PORT},
  "public_ingress_url": $(if [[ -n "${PUBLIC_INGRESS_URL}" ]]; then printf '"%s"' "${PUBLIC_INGRESS_URL}"; else printf 'null'; fi),
  "wallet_address": "${WALLET_ADDRESS}",
  "declared_location": "${DECLARED_LOCATION}",
  "auto_register": true
}
EOF

  chmod 640 "${CONFIG_PATH}"
  chown root:"${SERVICE_GROUP}" "${CONFIG_PATH}"
}

install_unit() {
  install -m 644 "${UNIT_SOURCE}" "${UNIT_TARGET}"
  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}"
  systemctl restart "${SERVICE_NAME}"
}

ensure_service_account() {
  if ! getent group "${SERVICE_GROUP}" >/dev/null 2>&1; then
    groupadd --system "${SERVICE_GROUP}"
  fi
  if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
    useradd --system --gid "${SERVICE_GROUP}" --home-dir "${WORKDIR}" --shell /usr/sbin/nologin "${SERVICE_USER}"
  fi
}

require_root

if [[ ! -x "${BINARY_PATH}" ]]; then
  echo "neuro-node binary not found or not executable at ${BINARY_PATH}" >&2
  exit 1
fi

if [[ -z "${MAX_GB}" ]]; then
  MAX_GB="$(prompt_default "How much storage do you want to rent out in GB?" "500")"
fi
STORAGE_PATH="$(prompt_default "Storage path for encrypted shard data" "${STORAGE_PATH}")"
GATEWAY_URL="$(prompt_default "Gateway URL" "${GATEWAY_URL}")"
RELAY_URL="$(prompt_default "Relay URL" "${RELAY_URL}")"
NODE_SECRET="$(prompt_default "Node onboarding secret (leave blank to skip auto-registration)" "${NODE_SECRET}")"
WALLET_ADDRESS="$(prompt_default "Payout wallet address" "${WALLET_ADDRESS}")"
DECLARED_LOCATION="$(prompt_default "Declared node location" "${DECLARED_LOCATION}")"
INGRESS_PORT="$(prompt_default "Direct ingress port" "${INGRESS_PORT}")"
PUBLIC_INGRESS_URL="$(prompt_default "Public ingress URL (optional, for direct browser transfer)" "${PUBLIC_INGRESS_URL}")"
FRONTEND_URL="$(prompt_default "Dashboard website URL" "${FRONTEND_URL}")"
DECLARED_LOCATION="${DECLARED_LOCATION^^}"

if ! [[ "${MAX_GB}" =~ ^[0-9]+$ ]] || [[ "${MAX_GB}" -le 0 ]]; then
  echo "MAX_GB must be a positive integer." >&2
  exit 1
fi

ensure_service_account
write_config
install_unit

NODE_ID="$(derive_node_id || true)"
if [[ -n "${NODE_ID}" ]]; then
  copy_to_clipboard "${NODE_ID}" || true
  open_dashboard "${NODE_ID}" || true
fi

echo "Installed ${SERVICE_NAME}."
echo "  binary: ${BINARY_PATH}"
echo "  config: ${CONFIG_PATH}"
echo "  storage: ${STORAGE_PATH}"
echo "  capacity_gb: ${MAX_GB}"
echo "  declared_location: ${DECLARED_LOCATION}"
echo "  ingress_port: ${INGRESS_PORT}"
if [[ -n "${NODE_ID}" ]]; then
  echo "  node_id: ${NODE_ID}"
  echo "  dashboard: ${FRONTEND_URL%/}/dashboard/node?node_id=${NODE_ID}"
  echo "  clipboard: attempted"
fi
if [[ -n "${NODE_SECRET}" ]]; then
  echo "  auto_registration: enabled"
else
  echo "  auto_registration: skipped (missing node secret)"
fi
echo "The node now runs silently in the background."
echo "Check status with: systemctl status ${SERVICE_NAME}"
