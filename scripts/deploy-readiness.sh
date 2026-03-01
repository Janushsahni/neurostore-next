#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/deploy/docker-compose.yml"
ENV_FILE="${ROOT_DIR}/deploy/.env"
BASE_URL="http://127.0.0.1:9009"
STRICT=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --strict)
      STRICT=1
      shift
      ;;
    --base-url)
      BASE_URL="$2"
      shift 2
      ;;
    --compose-file)
      COMPOSE_FILE="$2"
      shift 2
      ;;
    --env-file)
      ENV_FILE="$2"
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

env_value() {
  local key="$1"
  local line
  line="$(grep -E "^${key}=" "${ENV_FILE}" | tail -n 1 || true)"
  if [[ -z "${line}" ]]; then
    return 1
  fi
  printf '%s' "${line#*=}"
}

require_cmd curl
require_cmd jq
require_cmd docker
require_cmd grep
require_cmd diff
require_cmd mktemp

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "compose file not found: ${COMPOSE_FILE}" >&2
  exit 1
fi
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "env file not found: ${ENV_FILE}" >&2
  exit 1
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT

echo "[1/6] Checking compose service status"
PS_OUTPUT="$(docker compose -f "${COMPOSE_FILE}" ps -a)"
printf '%s\n' "${PS_OUTPUT}"
if printf '%s\n' "${PS_OUTPUT}" | grep -E 'Exited \(|Restarting|Dead' >/dev/null; then
  echo "compose has unhealthy containers" >&2
  exit 1
fi

RUNNING_SERVICES="$(docker compose -f "${COMPOSE_FILE}" ps --status running --services || true)"
for svc in neurostore-db neurostore-redis neurostore-gateway neurostore-lb neurostore-sentinel neurostore-web; do
  if ! grep -qx "${svc}" <<<"${RUNNING_SERVICES}"; then
    echo "required service is not running: ${svc}" >&2
    exit 1
  fi
done

echo "[2/6] Validating environment policy"
required_keys=(
  POSTGRES_USER
  POSTGRES_PASSWORD
  POSTGRES_DB
  DATABASE_URL
  REDIS_URL
  METADATA_SECRET
  JWT_SECRET
  PROOF_SUBMIT_TOKEN
  COMPLIANCE_SIGNING_KEY
  MACAROON_SECRET
  NODE_SHARED_SECRET
)
for key in "${required_keys[@]}"; do
  if ! value="$(env_value "${key}")"; then
    echo "missing required key in env file: ${key}" >&2
    exit 1
  fi
  if [[ -z "${value}" ]]; then
    echo "empty required key in env file: ${key}" >&2
    exit 1
  fi
done

if [[ "${STRICT}" == "1" ]]; then
  if grep -Ei 'change-me|change_this|generate_a_|dev-secret-change|CHANGE_ME' "${ENV_FILE}" >/dev/null; then
    echo "strict mode failed: env file still contains placeholder secrets" >&2
    exit 1
  fi

  database_url="$(env_value DATABASE_URL || true)"
  cookie_secure="$(env_value COOKIE_SECURE || true)"
  if [[ "${database_url}" == *"localhost"* || "${database_url}" == *"127.0.0.1"* ]]; then
    echo "strict mode failed: DATABASE_URL points to localhost, which breaks container-to-container access" >&2
    exit 1
  fi
  if [[ "${cookie_secure}" != "true" && "${cookie_secure}" != "1" ]]; then
    echo "strict mode failed: COOKIE_SECURE must be true for production traffic" >&2
    exit 1
  fi
fi

echo "[3/6] Checking gateway readiness endpoint"
READY_JSON="$(curl -fsS "${BASE_URL}/readyz")"
printf 'gateway readyz: %s\n' "${READY_JSON}"
jq -e '.status == "ok" and .ok == true' <<<"${READY_JSON}" >/dev/null
if [[ "${STRICT}" == "1" ]]; then
  jq -e '.production_ready == true' <<<"${READY_JSON}" >/dev/null || {
    echo "strict mode failed: gateway production_ready=false" >&2
    jq -r '.readiness_warnings[]? // empty' <<<"${READY_JSON}" | sed 's/^/  - /' >&2
    exit 1
  }
fi

echo "[4/6] Creating authenticated session"
EMAIL="deploy-readiness-$(date +%s)-$RANDOM@example.com"
PASSWORD="DeployReadiness123!"
REGISTER_PAYLOAD="$(jq -n --arg email "${EMAIL}" --arg password "${PASSWORD}" '{email:$email,password:$password}')"

REGISTER_CODE="$(curl -sS -o "${tmpdir}/register.json" -w '%{http_code}' \
  -c "${tmpdir}/cookies.txt" \
  -X POST "${BASE_URL}/auth/register" \
  -H 'content-type: application/json' \
  -d "${REGISTER_PAYLOAD}")"
if [[ "${REGISTER_CODE}" != "201" ]]; then
  echo "failed to register readiness user (http ${REGISTER_CODE})" >&2
  cat "${tmpdir}/register.json" >&2
  exit 1
fi
CSRF_TOKEN="$(jq -r '.csrf_token // empty' "${tmpdir}/register.json")"
if [[ -z "${CSRF_TOKEN}" ]]; then
  echo "missing csrf_token in auth response" >&2
  cat "${tmpdir}/register.json" >&2
  exit 1
fi

echo "[5/6] Verifying S3-style object flow (PUT/GET/LIST/DELETE)"
BUCKET="deploy-ready-${RANDOM}${RANDOM}"
KEY="smoke/deploy-ready.txt"
PAYLOAD_FILE="${tmpdir}/payload.txt"
DOWNLOADED_FILE="${tmpdir}/downloaded.txt"
printf 'deploy-ready-%s\n' "$(date +%s)" > "${PAYLOAD_FILE}"

PUT_CODE="$(curl -sS -o "${tmpdir}/put.out" -w '%{http_code}' \
  -X PUT "${BASE_URL}/${BUCKET}/${KEY}" \
  -b "${tmpdir}/cookies.txt" \
  -H "x-csrf-token: ${CSRF_TOKEN}" \
  -H 'content-type: text/plain' \
  --data-binary @"${PAYLOAD_FILE}")"
if [[ "${PUT_CODE}" != "200" ]]; then
  echo "put flow failed (http ${PUT_CODE})" >&2
  cat "${tmpdir}/put.out" >&2
  exit 1
fi

GET_CODE="$(curl -sS -o "${DOWNLOADED_FILE}" -w '%{http_code}' \
  -X GET "${BASE_URL}/${BUCKET}/${KEY}" \
  -b "${tmpdir}/cookies.txt")"
if [[ "${GET_CODE}" != "200" ]]; then
  echo "get flow failed (http ${GET_CODE})" >&2
  exit 1
fi
diff -q "${PAYLOAD_FILE}" "${DOWNLOADED_FILE}" >/dev/null

LIST_XML="$(curl -sS \
  -X GET "${BASE_URL}/${BUCKET}?prefix=smoke/" \
  -b "${tmpdir}/cookies.txt")"
if ! grep -q "${KEY}" <<<"${LIST_XML}"; then
  echo "list flow failed to include uploaded key" >&2
  echo "${LIST_XML}" >&2
  exit 1
fi

DELETE_CODE="$(curl -sS -o "${tmpdir}/delete.out" -w '%{http_code}' \
  -X DELETE "${BASE_URL}/${BUCKET}/${KEY}" \
  -b "${tmpdir}/cookies.txt" \
  -H "x-csrf-token: ${CSRF_TOKEN}")"
if [[ "${DELETE_CODE}" != "204" ]]; then
  echo "delete flow failed (http ${DELETE_CODE})" >&2
  cat "${tmpdir}/delete.out" >&2
  exit 1
fi

AFTER_DELETE_CODE="$(curl -sS -o "${tmpdir}/after-delete.out" -w '%{http_code}' \
  -X GET "${BASE_URL}/${BUCKET}/${KEY}" \
  -b "${tmpdir}/cookies.txt")"
if [[ "${AFTER_DELETE_CODE}" != "404" ]]; then
  echo "expected 404 after delete, got ${AFTER_DELETE_CODE}" >&2
  exit 1
fi

echo "[5b/6] Verifying node registration secret enforcement"
NODE_REG_UNAUTH_CODE="$(curl -sS -o "${tmpdir}/node-reg-unauth.out" -w '%{http_code}' \
  -X POST "${BASE_URL}/api/nodes/register" \
  -H 'content-type: application/json' \
  -d '{"peer_id":"ReadinessNode123","wallet_address":"0x1111111111111111111111111111111111111111","capacity_gb":50,"declared_location":"IN-KA"}')"
if [[ "${NODE_REG_UNAUTH_CODE}" != "401" ]]; then
  echo "node registration should reject missing x-node-secret, got ${NODE_REG_UNAUTH_CODE}" >&2
  exit 1
fi

NODE_SHARED_SECRET_VALUE="$(env_value NODE_SHARED_SECRET || true)"
if [[ -z "${NODE_SHARED_SECRET_VALUE}" ]]; then
  echo "NODE_SHARED_SECRET missing from env file" >&2
  exit 1
fi
NODE_REG_AUTH_CODE="$(curl -sS -o "${tmpdir}/node-reg-auth.out" -w '%{http_code}' \
  -X POST "${BASE_URL}/api/nodes/register" \
  -H 'content-type: application/json' \
  -H "x-node-secret: ${NODE_SHARED_SECRET_VALUE}" \
  -d '{"peer_id":"ReadinessNode123","wallet_address":"0x1111111111111111111111111111111111111111","capacity_gb":50,"declared_location":"IN-KA"}')"
if [[ "${NODE_REG_AUTH_CODE}" != "200" ]]; then
  echo "node registration with secret failed (http ${NODE_REG_AUTH_CODE})" >&2
  cat "${tmpdir}/node-reg-auth.out" >&2
  exit 1
fi

echo "[6/6] Completed"
printf 'base_url=%s\n' "${BASE_URL}"
printf 'bucket=%s\n' "${BUCKET}"
printf 'key=%s\n' "${KEY}"
echo "deploy readiness checks passed"
