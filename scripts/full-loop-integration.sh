#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="${ROOT_DIR}/.tmp/full-loop"
PASSWORD="integration-pass"
BUILD_TIMEOUT_S="${BUILD_TIMEOUT_S:-600}"
PEER_WAIT_TIMEOUT_S="${PEER_WAIT_TIMEOUT_S:-240}"

NODE1_PORT=9101
NODE2_PORT=9102
NODE3_PORT=9103

NODE1_DIR="${WORK_DIR}/node1"
NODE2_DIR="${WORK_DIR}/node2"
NODE3_DIR="${WORK_DIR}/node3"

NODE1_LOG="${WORK_DIR}/node1.log"
NODE2_LOG="${WORK_DIR}/node2.log"
NODE3_LOG="${WORK_DIR}/node3.log"

INPUT_FILE="${WORK_DIR}/input.bin"
RECOVERED_FILE="${WORK_DIR}/recovered.bin"
MANIFEST_FILE="${WORK_DIR}/manifest.json"
UPLOAD_REPORT="${WORK_DIR}/upload-report.json"
AUDIT_REPORT="${WORK_DIR}/audit-report.json"
AUTOPILOT_REPORT="${WORK_DIR}/autopilot-report.json"
RETRIEVE_REPORT="${WORK_DIR}/retrieve-report.json"
VALIDATE_REPORT="${WORK_DIR}/validate-report.json"
POLICY_FILE="${WORK_DIR}/policy.json"

NODE1_PID=""
NODE2_PID=""
NODE3_PID=""

cleanup() {
  set +e
  if [[ -n "${NODE1_PID}" ]]; then kill "${NODE1_PID}" 2>/dev/null || true; fi
  if [[ -n "${NODE2_PID}" ]]; then kill "${NODE2_PID}" 2>/dev/null || true; fi
  if [[ -n "${NODE3_PID}" ]]; then kill "${NODE3_PID}" 2>/dev/null || true; fi
}
trap cleanup EXIT

wait_for_peer_id() {
  local log_file="$1"
  local pid="$2"
  local timeout_s="${3:-25}"
  local deadline=$((SECONDS + timeout_s))

  while (( SECONDS < deadline )); do
    if [[ ! -d "/proc/${pid}" ]]; then
      echo "node process exited before peer id became available (${log_file})" >&2
      sed -n '1,120p' "${log_file}" >&2 || true
      return 1
    fi
    if grep -q "^error:" "${log_file}" 2>/dev/null; then
      echo "node startup failed (${log_file})" >&2
      sed -n '1,120p' "${log_file}" >&2 || true
      return 1
    fi
    if grep -q "Node peer id:" "${log_file}" 2>/dev/null; then
      grep "Node peer id:" "${log_file}" | tail -n 1 | awk '{print $4}'
      return 0
    fi
    sleep 0.2
  done
  echo "timed out waiting for peer id in ${log_file}" >&2
  return 1
}

start_node() {
  local storage="$1"
  local port="$2"
  local log="$3"

  mkdir -p "${storage}"
  "${ROOT_DIR}/target/debug/neuro-node" \
    --storage-path "${storage}" \
    --max-gb 1 \
    --listen "/ip4/127.0.0.1/tcp/${port}" \
    >"${log}" 2>&1 &
  echo "$!"
}

mkdir -p "${WORK_DIR}"
rm -rf "${WORK_DIR:?}"/*
mkdir -p "${NODE1_DIR}" "${NODE2_DIR}" "${NODE3_DIR}"

cd "${ROOT_DIR}"

echo "[0/9] Building binaries once (avoids compile races in background nodes)"
if command -v timeout >/dev/null 2>&1; then
  timeout "${BUILD_TIMEOUT_S}" cargo build -p neuro-node -p neuro-uploader
else
  cargo build -p neuro-node -p neuro-uploader
fi

echo "[1/9] Starting three local nodes"
NODE1_PID="$(start_node "${NODE1_DIR}" "${NODE1_PORT}" "${NODE1_LOG}")"
NODE2_PID="$(start_node "${NODE2_DIR}" "${NODE2_PORT}" "${NODE2_LOG}")"
NODE3_PID="$(start_node "${NODE3_DIR}" "${NODE3_PORT}" "${NODE3_LOG}")"

PEER1="$(wait_for_peer_id "${NODE1_LOG}" "${NODE1_PID}" "${PEER_WAIT_TIMEOUT_S}")"
PEER2="$(wait_for_peer_id "${NODE2_LOG}" "${NODE2_PID}" "${PEER_WAIT_TIMEOUT_S}")"
PEER3="$(wait_for_peer_id "${NODE3_LOG}" "${NODE3_PID}" "${PEER_WAIT_TIMEOUT_S}")"

ADDR1="/ip4/127.0.0.1/tcp/${NODE1_PORT}/p2p/${PEER1}"
ADDR2="/ip4/127.0.0.1/tcp/${NODE2_PORT}/p2p/${PEER2}"
ADDR3="/ip4/127.0.0.1/tcp/${NODE3_PORT}/p2p/${PEER3}"

echo "[2/9] Generating input payload"
python3 - <<'PY' "${INPUT_FILE}"
import os
import pathlib
import sys
path = pathlib.Path(sys.argv[1])
path.write_bytes(os.urandom(2 * 1024 * 1024))
PY

echo "[3/9] Uploading shards (biased away from node3)"
"${ROOT_DIR}/target/debug/neuro-uploader" upload \
  --file "${INPUT_FILE}" \
  --password "${PASSWORD}" \
  --peer "${ADDR1}" \
  --peer "${ADDR2}" \
  --peer "${ADDR3}" \
  --replica-factor 2 \
  --peer-score "${ADDR1}=100" \
  --peer-score "${ADDR2}=90" \
  --peer-score "${ADDR3}=10" \
  --manifest-out "${MANIFEST_FILE}" \
  --audit-rounds 3 \
  --report-out "${UPLOAD_REPORT}"

echo "[4/9] Auditing uploaded shards"
"${ROOT_DIR}/target/debug/neuro-uploader" audit \
  --manifest "${MANIFEST_FILE}" \
  --password "${PASSWORD}" \
  --sample 10 \
  --max-response-age-secs 120 \
  --report-out "${AUDIT_REPORT}"

echo "[5/9] Writing sentinel policy (peer-id only format)"
python3 - <<'PY' "${POLICY_FILE}" "${PEER1}" "${PEER2}" "${PEER3}"
import json
import pathlib
import sys

policy_path = pathlib.Path(sys.argv[1])
peer1, peer2, peer3 = sys.argv[2], sys.argv[3], sys.argv[4]
rows = [
    {"peer": peer1, "reputation": 9.0, "confidence": 0.95, "anomaly": True, "recommendation": "quarantine"},
    {"peer": peer2, "reputation": 93.0, "confidence": 0.91, "anomaly": False, "recommendation": "accept"},
    {"peer": peer3, "reputation": 88.0, "confidence": 0.86, "anomaly": False, "recommendation": "accept"},
]
policy_path.write_text(json.dumps(rows, indent=2), encoding="utf-8")
PY

echo "[6/9] Running autopilot repair loop"
"${ROOT_DIR}/target/debug/neuro-uploader" autopilot \
  --manifest "${MANIFEST_FILE}" \
  --password "${PASSWORD}" \
  --policy-file "${POLICY_FILE}" \
  --replica-factor 2 \
  --quarantine-reputation 40 \
  --min-confidence 0.5 \
  --report-out "${AUTOPILOT_REPORT}"

echo "[7/9] Validating updated manifest"
"${ROOT_DIR}/target/debug/neuro-uploader" validate \
  --manifest "${MANIFEST_FILE}" \
  --password "${PASSWORD}" \
  --report-out "${VALIDATE_REPORT}"

echo "[8/9] Retrieving and reconstructing payload"
"${ROOT_DIR}/target/debug/neuro-uploader" retrieve \
  --manifest "${MANIFEST_FILE}" \
  --password "${PASSWORD}" \
  --out "${RECOVERED_FILE}" \
  --max-response-age-secs 120 \
  --report-out "${RETRIEVE_REPORT}"

echo "[9/9] Verifying payload and autopilot outcomes"
cmp "${INPUT_FILE}" "${RECOVERED_FILE}"
python3 - <<'PY' "${AUTOPILOT_REPORT}" "${ADDR1}"
import json
import pathlib
import sys

report = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
quarantine_addr = sys.argv[2]
repaired = int(report.get("summary", {}).get("shards_repaired", 0))
if repaired <= 0:
    raise SystemExit("autopilot did not repair any shard")
quarantined = set(report.get("quarantined_peers", []))
if quarantine_addr not in quarantined:
    raise SystemExit("quarantined peer missing from action report")
print(f"autopilot repaired shards: {repaired}")
PY

echo "Full-loop integration PASSED"
echo "Artifacts: ${WORK_DIR}"
