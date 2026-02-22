#!/usr/bin/env bash
set -euo pipefail

CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-http://127.0.0.1:8080}"
S3_BASE_URL="${S3_BASE_URL:-http://127.0.0.1:9009/s3}"
SAMPLES=20
PAYLOAD_KB=256
STRICT=0
OUT_FILE=""
SKIP_NODE_SEED=0

TARGET_GET_P95_MS=400
TARGET_GET_P99_MS=900
TARGET_PUT_P95_MS=700
TARGET_PLACEMENT_P95_MS=250
TARGET_AI_STRATEGY_P95_MS=200
TARGET_AI_RISK_P95_MS=180

usage() {
  cat <<EOF
Usage: scripts/perf-kpi-gate.sh [options]

Options:
  --control-plane-url URL   Control-plane base URL (default: ${CONTROL_PLANE_URL})
  --s3-base-url URL         S3 gateway base URL (default: ${S3_BASE_URL})
  --samples N               Number of benchmark rounds (default: ${SAMPLES})
  --payload-kb N            Object payload size in KB (default: ${PAYLOAD_KB})
  --out PATH                Write JSON report to PATH
  --skip-node-seed          Do not register synthetic benchmark nodes
  --strict                  Fail with non-zero exit code on KPI target miss
  -h, --help                Show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --control-plane-url)
      CONTROL_PLANE_URL="$2"
      shift 2
      ;;
    --s3-base-url)
      S3_BASE_URL="$2"
      shift 2
      ;;
    --samples)
      SAMPLES="$2"
      shift 2
      ;;
    --payload-kb)
      PAYLOAD_KB="$2"
      shift 2
      ;;
    --out)
      OUT_FILE="$2"
      shift 2
      ;;
    --skip-node-seed)
      SKIP_NODE_SEED=1
      shift
      ;;
    --strict)
      STRICT=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

require_cmd curl
require_cmd jq
require_cmd python3
require_cmd date
require_cmd mktemp
require_cmd sha256sum

if ! [[ "$SAMPLES" =~ ^[0-9]+$ ]] || [[ "$SAMPLES" -lt 5 ]]; then
  echo "--samples must be an integer >= 5" >&2
  exit 1
fi
if ! [[ "$PAYLOAD_KB" =~ ^[0-9]+$ ]] || [[ "$PAYLOAD_KB" -lt 1 ]]; then
  echo "--payload-kb must be an integer >= 1" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d /tmp/neurostore-perf-gate.XXXXXX)"
cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

if [[ -z "${OUT_FILE}" ]]; then
  OUT_FILE="${TMP_DIR}/perf-kpi-report.json"
fi

PUT_TIMES="${TMP_DIR}/put_ms.txt"
GET_TIMES="${TMP_DIR}/get_ms.txt"
PLACEMENT_TIMES="${TMP_DIR}/placement_ms.txt"
AI_STRATEGY_TIMES="${TMP_DIR}/ai_strategy_ms.txt"
AI_RISK_TIMES="${TMP_DIR}/ai_risk_ms.txt"
touch "${PUT_TIMES}" "${GET_TIMES}" "${PLACEMENT_TIMES}" "${AI_STRATEGY_TIMES}" "${AI_RISK_TIMES}"

measure_curl() {
  local outfile="$1"
  shift
  local start_ns
  local end_ns
  local code
  start_ns="$(date +%s%N)"
  code="$(curl -sS -o "${outfile}" -w '%{http_code}' "$@")"
  end_ns="$(date +%s%N)"
  local elapsed_ms=$(( (end_ns - start_ns) / 1000000 ))
  printf '%s %s\n' "${elapsed_ms}" "${code}"
}

create_project_and_token() {
  local now
  now="$(date +%s)"
  local project_json
  project_json="$(curl -sS -X POST "${CONTROL_PLANE_URL}/v1/projects" \
    -H 'content-type: application/json' \
    -d "{\"name\":\"perf-gate-${now}\",\"billing_email\":\"perf@neurostore.test\",\"tier\":\"active\"}")"
  PROJECT_ID="$(jq -r '.project.project_id // .project_id // empty' <<<"${project_json}")"
  if [[ -z "${PROJECT_ID}" ]]; then
    echo "failed to create project: ${project_json}" >&2
    exit 1
  fi

  local token_json
  token_json="$(curl -sS -X POST "${CONTROL_PLANE_URL}/v1/tokens/macaroon" \
    -H 'content-type: application/json' \
    -d "{\"project_id\":\"${PROJECT_ID}\",\"bucket\":\"${BUCKET}\",\"prefix\":\"${PREFIX}/\",\"ops\":[\"put\",\"get\",\"head\",\"list\",\"delete\"],\"ttl_seconds\":3600}")"
  TOKEN="$(jq -r '.token // empty' <<<"${token_json}")"
  if [[ -z "${TOKEN}" ]]; then
    echo "failed to issue token: ${token_json}" >&2
    exit 1
  fi
}

seed_nodes() {
  local regions=("us-east" "us-west" "eu-central" "ap-south")
  local asns=("as-101" "as-102" "as-103" "as-104")
  local i
  for i in $(seq 1 14); do
    local node_id="bench-node-${i}"
    local region="${regions[$((i % ${#regions[@]}))]}"
    local asn="${asns[$((i % ${#asns[@]}))]}"
    local capacity=$((1200 + i * 40))
    local available=$((700 + i * 20))
    local bandwidth=$((250 + i * 45))
    local latency=$((35 + (i % 6) * 35))
    local uptime=$((97 + (i % 3)))
    local proof=$((96 + (i % 4)))

    if [[ $((i % 7)) -eq 0 ]]; then
      latency=$((900 + i * 10))
      proof=$((86 + (i % 3)))
      uptime=93
      available=$((80 + i))
    fi

    curl -sS -o /dev/null -X POST "${CONTROL_PLANE_URL}/v1/nodes/register" \
      -H 'content-type: application/json' \
      -d "{\"node_id\":\"${node_id}\",\"wallet\":\"0xbench$(printf '%04d' "${i}")\",\"region\":\"${region}\",\"asn\":\"${asn}\",\"capacity_gb\":${capacity},\"available_gb\":${available},\"bandwidth_mbps\":${bandwidth},\"uptime_pct\":${uptime},\"latency_ms\":${latency},\"proof_success_pct\":${proof}}"

    curl -sS -o /dev/null -X POST "${CONTROL_PLANE_URL}/v1/nodes/heartbeat" \
      -H 'content-type: application/json' \
      -d "{\"node_id\":\"${node_id}\",\"uptime_pct\":${uptime},\"latency_ms\":${latency},\"proof_success_pct\":${proof},\"available_gb\":${available},\"bandwidth_mbps\":${bandwidth}}"
  done
}

ingest_heat_usage() {
  local period
  period="$(date +%Y-%m)"
  curl -sS -o /dev/null -X POST "${CONTROL_PLANE_URL}/v1/usage/ingest" \
    -H 'content-type: application/json' \
    -d "{\"project_id\":\"${PROJECT_ID}\",\"period\":\"${period}\",\"storage_gb_hours\":540000,\"egress_gb\":3500,\"api_ops\":25000000}"
}

collect_stats_json() {
  python3 - "$@" <<'PY'
import json
import math
import statistics
import sys

def read_values(path):
    vals = []
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            raw = line.strip()
            if raw:
                vals.append(float(raw))
    return vals

def pct(sorted_values, p):
    if not sorted_values:
        return 0.0
    idx = int(math.floor((len(sorted_values) - 1) * p))
    idx = max(0, min(idx, len(sorted_values) - 1))
    return sorted_values[idx]

def stats(path):
    values = read_values(path)
    if not values:
        return {
            "count": 0,
            "min_ms": 0.0,
            "avg_ms": 0.0,
            "p50_ms": 0.0,
            "p95_ms": 0.0,
            "p99_ms": 0.0,
            "max_ms": 0.0,
        }
    ordered = sorted(values)
    return {
        "count": len(values),
        "min_ms": round(min(values), 2),
        "avg_ms": round(statistics.fmean(values), 2),
        "p50_ms": round(pct(ordered, 0.50), 2),
        "p95_ms": round(pct(ordered, 0.95), 2),
        "p99_ms": round(pct(ordered, 0.99), 2),
        "max_ms": round(max(values), 2),
    }

files = sys.argv[1:]
keys = ["put", "get", "placement", "ai_strategy", "ai_risk"]
out = {}
for key, path in zip(keys, files):
    out[key] = stats(path)
print(json.dumps(out))
PY
}

BUCKET="bench-$(date +%s)"
PREFIX="perf-gate"
PROJECT_ID=""
TOKEN=""
PUT_OK=0
GET_OK=0
PLACEMENT_OK=0
AI_STRATEGY_OK=0
AI_RISK_OK=0

echo "[1/4] Creating benchmark project and token"
create_project_and_token

if [[ "${SKIP_NODE_SEED}" -eq 0 ]]; then
  echo "[2/4] Seeding synthetic nodes for placement/risk benchmark"
  seed_nodes
else
  echo "[2/4] Skipping node seed"
fi

echo "[3/4] Ingesting hot usage profile for adaptive placement benchmark"
ingest_heat_usage

PAYLOAD_FILE="${TMP_DIR}/payload.bin"
python3 - <<'PY' "${PAYLOAD_FILE}" "${PAYLOAD_KB}"
import os
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
kb = int(sys.argv[2])
path.write_bytes(os.urandom(kb * 1024))
PY
PAYLOAD_SHA="$(sha256sum "${PAYLOAD_FILE}" | awk '{print $1}')"
PAYLOAD_BYTES=$((PAYLOAD_KB * 1024))

echo "[4/4] Running ${SAMPLES} benchmark rounds"
for i in $(seq 1 "${SAMPLES}"); do
  key="${PREFIX}/object-${i}.bin"
  object_url="${S3_BASE_URL}/${BUCKET}/${key}"

  read -r put_ms put_code < <(
    measure_curl "${TMP_DIR}/put.out" \
      -X PUT "${object_url}" \
      -H "authorization: Bearer ${TOKEN}" \
      -H 'content-type: application/octet-stream' \
      --data-binary @"${PAYLOAD_FILE}"
  )
  echo "${put_ms}" >> "${PUT_TIMES}"
  if [[ "${put_code}" == "200" ]]; then
    PUT_OK=$((PUT_OK + 1))
  fi

  read -r get_ms get_code < <(
    measure_curl "${TMP_DIR}/get.out" \
      "${object_url}" \
      -H "authorization: Bearer ${TOKEN}"
  )
  echo "${get_ms}" >> "${GET_TIMES}"
  if [[ "${get_code}" == "200" ]]; then
    got_sha="$(sha256sum "${TMP_DIR}/get.out" | awk '{print $1}')"
    if [[ "${got_sha}" == "${PAYLOAD_SHA}" ]]; then
      GET_OK=$((GET_OK + 1))
    fi
  fi

  read -r placement_ms placement_code < <(
    measure_curl "${TMP_DIR}/placement.out" \
      -X POST "${CONTROL_PLANE_URL}/v1/placement/suggest" \
      -H 'content-type: application/json' \
      -d "{\"project_id\":\"${PROJECT_ID}\",\"objective\":\"latency\",\"auto_replica\":true,\"object_size_mb\":$((PAYLOAD_KB / 1024 + 1)),\"replica_count\":3}"
  )
  echo "${placement_ms}" >> "${PLACEMENT_TIMES}"
  if [[ "${placement_code}" == "200" ]]; then
    PLACEMENT_OK=$((PLACEMENT_OK + 1))
  fi

  read -r strategy_ms strategy_code < <(
    measure_curl "${TMP_DIR}/ai_strategy.out" \
      "${CONTROL_PLANE_URL}/v1/ai/placement/strategy?project_id=${PROJECT_ID}&objective=latency&object_size_mb=$((PAYLOAD_KB / 1024 + 1))"
  )
  echo "${strategy_ms}" >> "${AI_STRATEGY_TIMES}"
  if [[ "${strategy_code}" == "200" ]]; then
    AI_STRATEGY_OK=$((AI_STRATEGY_OK + 1))
  fi

  read -r risk_ms risk_code < <(
    measure_curl "${TMP_DIR}/ai_risk.out" \
      "${CONTROL_PLANE_URL}/v1/ai/nodes/risk?limit=50"
  )
  echo "${risk_ms}" >> "${AI_RISK_TIMES}"
  if [[ "${risk_code}" == "200" ]]; then
    AI_RISK_OK=$((AI_RISK_OK + 1))
  fi
done

LATENCY_JSON="$(
  collect_stats_json \
    "${PUT_TIMES}" \
    "${GET_TIMES}" \
    "${PLACEMENT_TIMES}" \
    "${AI_STRATEGY_TIMES}" \
    "${AI_RISK_TIMES}"
)"

SUCCESS_JSON="$(jq -n \
  --argjson samples "${SAMPLES}" \
  --argjson put_ok "${PUT_OK}" \
  --argjson get_ok "${GET_OK}" \
  --argjson placement_ok "${PLACEMENT_OK}" \
  --argjson ai_strategy_ok "${AI_STRATEGY_OK}" \
  --argjson ai_risk_ok "${AI_RISK_OK}" \
  '{
      put: {ok: $put_ok, success_rate: (($put_ok / $samples) * 100)},
      get: {ok: $get_ok, success_rate: (($get_ok / $samples) * 100)},
      placement: {ok: $placement_ok, success_rate: (($placement_ok / $samples) * 100)},
      ai_strategy: {ok: $ai_strategy_ok, success_rate: (($ai_strategy_ok / $samples) * 100)},
      ai_risk: {ok: $ai_risk_ok, success_rate: (($ai_risk_ok / $samples) * 100)}
    }'
)"

REPORT_JSON="$(jq -n \
  --arg generated_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg control_plane_url "${CONTROL_PLANE_URL}" \
  --arg s3_base_url "${S3_BASE_URL}" \
  --arg project_id "${PROJECT_ID}" \
  --arg bucket "${BUCKET}" \
  --argjson samples "${SAMPLES}" \
  --argjson payload_kb "${PAYLOAD_KB}" \
  --argjson payload_bytes "${PAYLOAD_BYTES}" \
  --argjson strict "${STRICT}" \
  --argjson latency "${LATENCY_JSON}" \
  --argjson success "${SUCCESS_JSON}" \
  --argjson target_put_p95 "${TARGET_PUT_P95_MS}" \
  --argjson target_get_p95 "${TARGET_GET_P95_MS}" \
  --argjson target_get_p99 "${TARGET_GET_P99_MS}" \
  --argjson target_place_p95 "${TARGET_PLACEMENT_P95_MS}" \
  --argjson target_ai_strategy_p95 "${TARGET_AI_STRATEGY_P95_MS}" \
  --argjson target_ai_risk_p95 "${TARGET_AI_RISK_P95_MS}" \
  '{
      generated_at: $generated_at,
      benchmark: {
        samples: $samples,
        payload_kb: $payload_kb,
        payload_bytes: $payload_bytes,
        control_plane_url: $control_plane_url,
        s3_base_url: $s3_base_url,
        project_id: $project_id,
        bucket: $bucket
      },
      latency: $latency,
      success: $success,
      targets: {
        put_p95_ms: $target_put_p95,
        get_p95_ms: $target_get_p95,
        get_p99_ms: $target_get_p99,
        placement_p95_ms: $target_place_p95,
        ai_strategy_p95_ms: $target_ai_strategy_p95,
        ai_risk_p95_ms: $target_ai_risk_p95,
        min_success_rate_pct: 100
      },
      competitor_reference: {
        filecoin_retrieve_p95_ms: 2500,
        storj_retrieve_p95_ms: 700,
        arweave_retrieve_p95_ms: 1800
      },
      strict_mode: ($strict == 1)
    }'
)"

echo "${REPORT_JSON}" | jq '.' > "${OUT_FILE}"

echo "Benchmark report written to ${OUT_FILE}"
echo ""
echo "Latency summary (ms):"
TABLE_ROWS="$(jq -r '
  [
    ["operation","p50","p95","p99","avg","success_%"],
    ["put", (.latency.put.p50_ms|tostring), (.latency.put.p95_ms|tostring), (.latency.put.p99_ms|tostring), (.latency.put.avg_ms|tostring), (.success.put.success_rate|tostring)],
    ["get", (.latency.get.p50_ms|tostring), (.latency.get.p95_ms|tostring), (.latency.get.p99_ms|tostring), (.latency.get.avg_ms|tostring), (.success.get.success_rate|tostring)],
    ["placement", (.latency.placement.p50_ms|tostring), (.latency.placement.p95_ms|tostring), (.latency.placement.p99_ms|tostring), (.latency.placement.avg_ms|tostring), (.success.placement.success_rate|tostring)],
    ["ai_strategy", (.latency.ai_strategy.p50_ms|tostring), (.latency.ai_strategy.p95_ms|tostring), (.latency.ai_strategy.p99_ms|tostring), (.latency.ai_strategy.avg_ms|tostring), (.success.ai_strategy.success_rate|tostring)],
    ["ai_risk", (.latency.ai_risk.p50_ms|tostring), (.latency.ai_risk.p95_ms|tostring), (.latency.ai_risk.p99_ms|tostring), (.latency.ai_risk.avg_ms|tostring), (.success.ai_risk.success_rate|tostring)]
  ] | .[] | @tsv
' < "${OUT_FILE}")"
if command -v column >/dev/null 2>&1; then
  printf '%s\n' "${TABLE_ROWS}" | column -t -s $'\t'
else
  printf '%s\n' "${TABLE_ROWS}"
fi

GET_P95="$(jq -r '.latency.get.p95_ms' < "${OUT_FILE}")"
BEATS_FILECOIN="$(python3 - <<PY "${GET_P95}"
import sys
lat = float(sys.argv[1])
print("true" if lat < 2500 else "false")
PY
)"
BEATS_STORJ="$(python3 - <<PY "${GET_P95}"
import sys
lat = float(sys.argv[1])
print("true" if lat < 700 else "false")
PY
)"

echo ""
echo "Segment comparison (retrieve p95):"
echo "  - vs Filecoin reference (2500ms): ${BEATS_FILECOIN}"
echo "  - vs Storj reference (700ms): ${BEATS_STORJ}"

STRICT_FAIL=0
STRICT_REASONS=()

check_target() {
  local metric_value="$1"
  local metric_target="$2"
  local metric_name="$3"
  python3 - <<PY "${metric_value}" "${metric_target}" "${metric_name}"
import sys
value = float(sys.argv[1])
target = float(sys.argv[2])
name = sys.argv[3]
if value > target:
    print(f"{name}={value} exceeds target={target}")
PY
}

maybe_fail="$(check_target "$(jq -r '.latency.put.p95_ms' < "${OUT_FILE}")" "${TARGET_PUT_P95_MS}" "put_p95_ms")"
if [[ -n "${maybe_fail}" ]]; then STRICT_REASONS+=("${maybe_fail}"); fi

maybe_fail="$(check_target "$(jq -r '.latency.get.p95_ms' < "${OUT_FILE}")" "${TARGET_GET_P95_MS}" "get_p95_ms")"
if [[ -n "${maybe_fail}" ]]; then STRICT_REASONS+=("${maybe_fail}"); fi

maybe_fail="$(check_target "$(jq -r '.latency.get.p99_ms' < "${OUT_FILE}")" "${TARGET_GET_P99_MS}" "get_p99_ms")"
if [[ -n "${maybe_fail}" ]]; then STRICT_REASONS+=("${maybe_fail}"); fi

maybe_fail="$(check_target "$(jq -r '.latency.placement.p95_ms' < "${OUT_FILE}")" "${TARGET_PLACEMENT_P95_MS}" "placement_p95_ms")"
if [[ -n "${maybe_fail}" ]]; then STRICT_REASONS+=("${maybe_fail}"); fi

maybe_fail="$(check_target "$(jq -r '.latency.ai_strategy.p95_ms' < "${OUT_FILE}")" "${TARGET_AI_STRATEGY_P95_MS}" "ai_strategy_p95_ms")"
if [[ -n "${maybe_fail}" ]]; then STRICT_REASONS+=("${maybe_fail}"); fi

maybe_fail="$(check_target "$(jq -r '.latency.ai_risk.p95_ms' < "${OUT_FILE}")" "${TARGET_AI_RISK_P95_MS}" "ai_risk_p95_ms")"
if [[ -n "${maybe_fail}" ]]; then STRICT_REASONS+=("${maybe_fail}"); fi

for op in put get placement ai_strategy ai_risk; do
  success_rate="$(jq -r ".success.${op}.success_rate" < "${OUT_FILE}")"
  if [[ "${success_rate}" != "100" && "${success_rate}" != "100.0" ]]; then
    STRICT_REASONS+=("${op}_success_rate=${success_rate} below target=100")
  fi
done

if [[ "${#STRICT_REASONS[@]}" -gt 0 ]]; then
  STRICT_FAIL=1
fi

if [[ "${STRICT}" -eq 1 ]]; then
  if [[ "${STRICT_FAIL}" -eq 1 ]]; then
    echo ""
    echo "KPI gate FAILED:"
    for reason in "${STRICT_REASONS[@]}"; do
      echo "  - ${reason}"
    done
    exit 1
  fi
  echo ""
  echo "KPI gate PASSED."
fi
