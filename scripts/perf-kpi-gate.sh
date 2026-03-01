#!/usr/bin/env bash
set -euo pipefail

SAMPLES=20
PAYLOAD_KB=128
STRICT=0
BASE_URL="http://127.0.0.1:9009"
MAX_PUT_P95_MS=700
MAX_GET_P95_MS=400
MAX_GET_P99_MS=900
MIN_SUCCESS_RATE=1.0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --samples)
      SAMPLES="$2"
      shift 2
      ;;
    --payload-kb)
      PAYLOAD_KB="$2"
      shift 2
      ;;
    --strict)
      STRICT=1
      shift
      ;;
    --base-url)
      BASE_URL="$2"
      shift 2
      ;;
    --max-put-p95-ms)
      MAX_PUT_P95_MS="$2"
      shift 2
      ;;
    --max-get-p95-ms)
      MAX_GET_P95_MS="$2"
      shift 2
      ;;
    --max-get-p99-ms)
      MAX_GET_P99_MS="$2"
      shift 2
      ;;
    --min-success-rate)
      MIN_SUCCESS_RATE="$2"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
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

percentile_from_file() {
  local file="$1"
  local p="$2"
  sort -n "${file}" | awk -v pct="${p}" '
    { values[NR] = $1 }
    END {
      if (NR == 0) {
        print 0
        exit
      }
      idx = int((pct / 100.0) * NR)
      if (idx < 1) idx = 1
      if (idx > NR) idx = NR
      print values[idx]
    }
  '
}

avg_from_file() {
  local file="$1"
  awk '
    { sum += $1 }
    END {
      if (NR == 0) {
        print 0
      } else {
        printf "%.2f\n", sum / NR
      }
    }
  ' "${file}"
}

require_cmd curl
require_cmd jq
require_cmd awk
require_cmd sort
require_cmd cmp
require_cmd mktemp

tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT

put_times_file="${tmpdir}/put_ms.txt"
get_times_file="${tmpdir}/get_ms.txt"
touch "${put_times_file}" "${get_times_file}"

echo "[1/5] Checking gateway readiness"
READY_JSON="$(curl -fsS "${BASE_URL}/readyz")"
jq -e '.status == "ok"' <<<"${READY_JSON}" >/dev/null

echo "[2/5] Creating auth session for benchmark"
EMAIL="perf-gate-$(date +%s)-$RANDOM@example.com"
PASSWORD="PerfGatePass123!"
REGISTER_PAYLOAD="$(jq -n --arg email "${EMAIL}" --arg password "${PASSWORD}" '{email:$email,password:$password}')"

REGISTER_CODE="$(curl -sS -o "${tmpdir}/register.json" -w '%{http_code}' \
  -c "${tmpdir}/cookies.txt" \
  -X POST "${BASE_URL}/auth/register" \
  -H 'content-type: application/json' \
  -d "${REGISTER_PAYLOAD}")"
if [[ "${REGISTER_CODE}" != "201" ]]; then
  echo "failed to register benchmark user (http ${REGISTER_CODE})" >&2
  cat "${tmpdir}/register.json" >&2
  exit 1
fi
CSRF_TOKEN="$(jq -r '.csrf_token // empty' "${tmpdir}/register.json")"
if [[ -z "${CSRF_TOKEN}" ]]; then
  echo "missing csrf_token in auth response" >&2
  exit 1
fi

echo "[3/5] Running ${SAMPLES} PUT/GET samples (${PAYLOAD_KB}KB payload)"
PAYLOAD_FILE="${tmpdir}/payload.bin"
GET_FILE="${tmpdir}/download.bin"
head -c "$((PAYLOAD_KB * 1024))" /dev/urandom > "${PAYLOAD_FILE}"

BUCKET="perf-gate-${RANDOM}${RANDOM}"
SUCCESS=0
FAIL=0

for i in $(seq 1 "${SAMPLES}"); do
  KEY="sample-${i}.bin"

  PUT_RESULT="$(curl -sS -o "${tmpdir}/put.out" -w '%{http_code} %{time_total}' \
    -X PUT "${BASE_URL}/${BUCKET}/${KEY}" \
    -b "${tmpdir}/cookies.txt" \
    -H "x-csrf-token: ${CSRF_TOKEN}" \
    -H 'content-type: application/octet-stream' \
    --data-binary @"${PAYLOAD_FILE}")"
  PUT_CODE="$(awk '{print $1}' <<<"${PUT_RESULT}")"
  PUT_MS="$(awk '{printf "%.2f", $2 * 1000}' <<<"${PUT_RESULT}")"

  if [[ "${PUT_CODE}" != "200" ]]; then
    echo "sample ${i}: put failed (http ${PUT_CODE})"
    FAIL=$((FAIL + 1))
    continue
  fi
  echo "${PUT_MS}" >> "${put_times_file}"

  GET_RESULT="$(curl -sS -o "${GET_FILE}" -w '%{http_code} %{time_total}' \
    -X GET "${BASE_URL}/${BUCKET}/${KEY}" \
    -b "${tmpdir}/cookies.txt")"
  GET_CODE="$(awk '{print $1}' <<<"${GET_RESULT}")"
  GET_MS="$(awk '{printf "%.2f", $2 * 1000}' <<<"${GET_RESULT}")"

  if [[ "${GET_CODE}" != "200" ]]; then
    echo "sample ${i}: get failed (http ${GET_CODE})"
    FAIL=$((FAIL + 1))
    continue
  fi
  if ! cmp -s "${PAYLOAD_FILE}" "${GET_FILE}"; then
    echo "sample ${i}: payload mismatch"
    FAIL=$((FAIL + 1))
    continue
  fi
  echo "${GET_MS}" >> "${get_times_file}"

  curl -sS -o /dev/null \
    -X DELETE "${BASE_URL}/${BUCKET}/${KEY}" \
    -b "${tmpdir}/cookies.txt" \
    -H "x-csrf-token: ${CSRF_TOKEN}" || true

  SUCCESS=$((SUCCESS + 1))
  echo "sample ${i}: put=${PUT_MS}ms get=${GET_MS}ms"
done

echo "[4/5] Calculating KPI metrics"
TOTAL=$((SUCCESS + FAIL))
if [[ "${TOTAL}" -eq 0 ]]; then
  echo "no samples executed" >&2
  exit 1
fi

SUCCESS_RATE="$(awk -v s="${SUCCESS}" -v t="${TOTAL}" 'BEGIN { printf "%.4f", s / t }')"
PUT_AVG="$(avg_from_file "${put_times_file}")"
GET_AVG="$(avg_from_file "${get_times_file}")"
PUT_P95="$(percentile_from_file "${put_times_file}" 95)"
GET_P95="$(percentile_from_file "${get_times_file}" 95)"
GET_P99="$(percentile_from_file "${get_times_file}" 99)"

echo "success_rate=${SUCCESS_RATE} (${SUCCESS}/${TOTAL})"
echo "put_avg_ms=${PUT_AVG}"
echo "put_p95_ms=${PUT_P95}"
echo "get_avg_ms=${GET_AVG}"
echo "get_p95_ms=${GET_P95}"
echo "get_p99_ms=${GET_P99}"

echo "[5/5] Evaluating KPI gate"
if [[ "${STRICT}" == "1" ]]; then
  awk -v v="${SUCCESS_RATE}" -v min="${MIN_SUCCESS_RATE}" 'BEGIN { exit(v + 0 < min + 0) }' || {
    echo "strict gate failed: success_rate ${SUCCESS_RATE} < ${MIN_SUCCESS_RATE}" >&2
    exit 1
  }
  awk -v v="${PUT_P95}" -v max="${MAX_PUT_P95_MS}" 'BEGIN { exit(v + 0 > max + 0) }' || {
    echo "strict gate failed: put_p95_ms ${PUT_P95} > ${MAX_PUT_P95_MS}" >&2
    exit 1
  }
  awk -v v="${GET_P95}" -v max="${MAX_GET_P95_MS}" 'BEGIN { exit(v + 0 > max + 0) }' || {
    echo "strict gate failed: get_p95_ms ${GET_P95} > ${MAX_GET_P95_MS}" >&2
    exit 1
  }
  awk -v v="${GET_P99}" -v max="${MAX_GET_P99_MS}" 'BEGIN { exit(v + 0 > max + 0) }' || {
    echo "strict gate failed: get_p99_ms ${GET_P99} > ${MAX_GET_P99_MS}" >&2
    exit 1
  }
fi

echo "kpi gate completed"
