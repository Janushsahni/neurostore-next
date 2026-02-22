#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/deploy/docker-compose.option-a.yml"
STRICT=0

if [[ "${1:-}" == "--strict" ]]; then
  STRICT=1
fi

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

require_cmd curl
require_cmd jq
require_cmd docker

echo "[1/6] Checking compose service status"
PS_OUTPUT="$(docker compose -f "${COMPOSE_FILE}" ps -a)"
printf '%s\n' "${PS_OUTPUT}"
if printf '%s\n' "${PS_OUTPUT}" | grep -E 'Exited \(|Restarting|Dead' >/dev/null; then
  echo "compose has unhealthy containers" >&2
  exit 1
fi

echo "[2/6] Checking readiness endpoints"
CP_READY="$(curl -sS http://127.0.0.1:8080/readyz)"
S3_READY="$(curl -sS http://127.0.0.1:9009/readyz)"
printf 'control-plane readyz: %s\n' "${CP_READY}"
printf 's3-gateway readyz: %s\n' "${S3_READY}"

jq -e '.ok == true' <<<"${CP_READY}" >/dev/null
jq -e '.ok == true' <<<"${S3_READY}" >/dev/null

CP_PROD_READY="$(jq -r '.production_ready // false' <<<"${CP_READY}")"
S3_PROD_READY="$(jq -r '.production_ready // false' <<<"${S3_READY}")"

if [[ "${CP_PROD_READY}" != "true" ]]; then
  echo "warning: control-plane production_ready=false"
  jq -r '.readiness_warnings[]? // empty' <<<"${CP_READY}" | sed 's/^/  - /'
fi
if [[ "${S3_PROD_READY}" != "true" ]]; then
  echo "warning: s3-gateway production_ready=false"
  jq -r '.readiness_warnings[]? // empty' <<<"${S3_READY}" | sed 's/^/  - /'
fi
if [[ "${STRICT}" == "1" && ( "${CP_PROD_READY}" != "true" || "${S3_PROD_READY}" != "true" ) ]]; then
  echo "strict mode failed: production readiness warnings detected" >&2
  exit 1
fi

echo "[3/6] Bearer token upload/download/list"
PROJECT_JSON="$(curl -sS -X POST http://127.0.0.1:8080/v1/projects -H 'content-type: application/json' -d '{"name":"deploy-readiness","billing_email":"ops@acme.test","tier":"archive"}')"
PROJECT_ID="$(jq -r '.project.project_id // .project_id' <<<"${PROJECT_JSON}")"
TOKEN="$(curl -sS -X POST http://127.0.0.1:8080/v1/tokens/macaroon -H 'content-type: application/json' -d "{\"project_id\":\"${PROJECT_ID}\",\"bucket\":\"acme-bucket\",\"prefix\":\"datasets/\",\"ops\":[\"put\",\"get\",\"head\",\"list\",\"delete\"],\"ttl_seconds\":3600}" | jq -r '.token')"

echo "deploy-ready-$(date +%s)" > /tmp/neurostore-deploy-ready.txt

PUT_CODE="$(curl -sS -o /tmp/neurostore-put.txt -w '%{http_code}' -X PUT "http://127.0.0.1:9009/s3/acme-bucket/datasets/deploy-ready.txt" -H "authorization: Bearer ${TOKEN}" --data-binary @/tmp/neurostore-deploy-ready.txt)"
HEAD_CODE="$(curl -sS -o /tmp/neurostore-head.txt -w '%{http_code}' -I "http://127.0.0.1:9009/s3/acme-bucket/datasets/deploy-ready.txt" -H "authorization: Bearer ${TOKEN}")"
GET_BODY="$(curl -sS "http://127.0.0.1:9009/s3/acme-bucket/datasets/deploy-ready.txt" -H "authorization: Bearer ${TOKEN}")"
LIST_XML="$(curl -sS "http://127.0.0.1:9009/s3/acme-bucket?list-type=2&prefix=datasets/" -H "authorization: Bearer ${TOKEN}")"
EXPECTED="$(cat /tmp/neurostore-deploy-ready.txt)"

if [[ "${PUT_CODE}" != "200" || "${HEAD_CODE}" != "200" || "${GET_BODY}" != "${EXPECTED}" ]]; then
  echo "bearer flow failed" >&2
  exit 1
fi
if ! grep -q 'datasets/deploy-ready.txt' <<<"${LIST_XML}"; then
  echo "list operation failed" >&2
  exit 1
fi

echo "[4/6] SigV4 flow"
AWS_BIN=""
if command -v aws >/dev/null 2>&1; then
  AWS_BIN="$(command -v aws)"
elif [[ -x /tmp/awscli-venv/bin/aws ]]; then
  AWS_BIN="/tmp/awscli-venv/bin/aws"
fi

if [[ -n "${AWS_BIN}" ]]; then
  SIGV4_KEY_JSON="$(curl -sS -X POST http://127.0.0.1:8080/v1/sigv4/keys \
    -H 'content-type: application/json' \
    -d "{\"project_id\":\"${PROJECT_ID}\",\"label\":\"deploy-readiness\",\"bucket\":\"acme-bucket\",\"prefix\":\"datasets/\",\"ops\":[\"put\",\"get\",\"head\",\"list\",\"delete\"],\"region\":\"us-east-1\",\"service\":\"s3\",\"ttl_seconds\":3600}")"
  SIGV4_ACCESS_KEY="$(jq -r '.key.access_key // empty' <<<"${SIGV4_KEY_JSON}")"
  SIGV4_SECRET_KEY="$(jq -r '.key.secret_key // empty' <<<"${SIGV4_KEY_JSON}")"
  if [[ -z "${SIGV4_ACCESS_KEY}" || -z "${SIGV4_SECRET_KEY}" ]]; then
    echo "failed to issue dynamic sigv4 key: ${SIGV4_KEY_JSON}" >&2
    exit 1
  fi

  AWS_ACCESS_KEY_ID="${SIGV4_ACCESS_KEY}" \
  AWS_SECRET_ACCESS_KEY="${SIGV4_SECRET_KEY}" \
  AWS_DEFAULT_REGION=us-east-1 \
  "${AWS_BIN}" s3api put-object \
    --endpoint-url http://127.0.0.1:9009/s3 \
    --bucket acme-bucket \
    --key datasets/deploy-sigv4.txt \
    --body /tmp/neurostore-deploy-ready.txt >/tmp/neurostore-sigv4-put.json

  AWS_ACCESS_KEY_ID="${SIGV4_ACCESS_KEY}" \
  AWS_SECRET_ACCESS_KEY="${SIGV4_SECRET_KEY}" \
  AWS_DEFAULT_REGION=us-east-1 \
  "${AWS_BIN}" s3api get-object \
    --endpoint-url http://127.0.0.1:9009/s3 \
    --bucket acme-bucket \
    --key datasets/deploy-sigv4.txt \
    /tmp/neurostore-sigv4-downloaded.txt >/tmp/neurostore-sigv4-get.json

  diff -q /tmp/neurostore-deploy-ready.txt /tmp/neurostore-sigv4-downloaded.txt >/dev/null
else
  echo "warning: aws cli not found; skipping SigV4 aws-cli check"
fi

echo "[5/6] Usage and payout endpoints"
USAGE_JSON="$(curl -sS "http://127.0.0.1:8080/v1/usage/${PROJECT_ID}?period=$(date +%Y-%m)")"
PAYOUT_JSON="$(curl -sS "http://127.0.0.1:8080/v1/payouts/preview?period=$(date +%Y-%m)")"
jq -e '.ok == true' <<<"${USAGE_JSON}" >/dev/null
jq -e '.ok == true' <<<"${PAYOUT_JSON}" >/dev/null

echo "[6/6] Completed"
printf 'project_id=%s\n' "${PROJECT_ID}"
printf 'usage_api_ops=%s\n' "$(jq -r '.usage.api_ops // 0' <<<"${USAGE_JSON}")"
printf 'payout_total_usd=%s\n' "$(jq -r '.total_payout_usd // 0' <<<"${PAYOUT_JSON}")"

echo "deploy readiness checks passed"
