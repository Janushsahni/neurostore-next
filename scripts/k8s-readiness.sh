#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/deploy/.env.option-a"
STRICT=0
KUBECTL_IMAGE="bitnami/kubectl:latest"
KUBECONFORM_IMAGE="ghcr.io/yannh/kubeconform:v0.6.7"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --strict)
      STRICT=1
      shift
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

require_cmd docker
require_cmd grep
require_cmd awk

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "env file not found: ${ENV_FILE}" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

echo "[1/6] Validating production env policy"
MACAROON_SECRET_VALUE="${MACAROON_SECRET:-}"
PRESIGN_SECRET_VALUE="${PRESIGN_SECRET:-}"
INTERNAL_TOKEN_VALUE="${INTERNAL_API_TOKEN:-}"
MACAROON_SECRET_LEN=${#MACAROON_SECRET_VALUE}
PRESIGN_SECRET_LEN=${#PRESIGN_SECRET_VALUE}
INTERNAL_TOKEN_LEN=${#INTERNAL_TOKEN_VALUE}

if [[ ${MACAROON_SECRET_LEN} -lt 32 ]]; then
  echo "MACAROON_SECRET must be >= 32 chars" >&2
  exit 1
fi
if [[ ${PRESIGN_SECRET_LEN} -lt 32 ]]; then
  echo "PRESIGN_SECRET must be >= 32 chars" >&2
  exit 1
fi
if [[ ${INTERNAL_TOKEN_LEN} -lt 24 ]]; then
  echo "INTERNAL_API_TOKEN must be >= 24 chars" >&2
  exit 1
fi

if [[ "${STATE_BACKEND:-}" != "postgres" ]]; then
  echo "STATE_BACKEND must be postgres" >&2
  exit 1
fi
if [[ "${STATE_BACKEND_FALLBACK_TO_FILE:-}" != "false" && "${STRICT}" == "1" ]]; then
  echo "STATE_BACKEND_FALLBACK_TO_FILE must be false in strict mode" >&2
  exit 1
fi
if [[ "${SIGV4_PROVIDER:-}" != "control-plane" ]]; then
  echo "SIGV4_PROVIDER must be control-plane" >&2
  exit 1
fi
if [[ "${SIGV4_CREDENTIALS_JSON:-[]}" != "[]" && "${STRICT}" == "1" ]]; then
  echo "SIGV4_CREDENTIALS_JSON must be [] in strict mode" >&2
  exit 1
fi
if [[ -z "${CONTROL_PLANE_HOST:-}" || -z "${S3_HOST:-}" ]]; then
  echo "CONTROL_PLANE_HOST and S3_HOST are required" >&2
  exit 1
fi
if [[ "${CONTROL_PLANE_HOST}" == *"example.com"* || "${S3_HOST}" == *"example.com"* ]]; then
  echo "hosts must not use example.com" >&2
  exit 1
fi

echo "[2/6] Generating Kubernetes secrets/overlay"
"${ROOT_DIR}/scripts/generate-k8s-secrets.sh" "${ENV_FILE}" "${ROOT_DIR}/deploy/k8s/generated"

echo "[3/6] Checking generated secret manifests"
for f in control-plane-secret.yaml s3-gateway-secret.yaml ingress-patch.yaml kustomization.yaml; do
  if [[ ! -f "${ROOT_DIR}/deploy/k8s/generated/${f}" ]]; then
    echo "missing generated file: ${f}" >&2
    exit 1
  fi
done
if grep -R "replace-with-" -n "${ROOT_DIR}/deploy/k8s/generated" >/dev/null 2>&1; then
  echo "generated manifests still contain placeholder values" >&2
  exit 1
fi

echo "[4/6] Rendering base and production kustomize"
mkdir -p /tmp/neurostore-k8s

docker run --rm \
  -v "${ROOT_DIR}":/work \
  -w /work \
  "${KUBECTL_IMAGE}" \
  kustomize deploy/k8s/base > /tmp/neurostore-k8s/base.yaml

docker run --rm \
  -v "${ROOT_DIR}":/work \
  -w /work \
  "${KUBECTL_IMAGE}" \
  kustomize deploy/k8s/generated > /tmp/neurostore-k8s/prod.yaml

echo "[5/6] Schema validation (kubeconform)"
KUBECONFORM_ARGS=(-summary)
if [[ "${STRICT}" == "1" ]]; then
  KUBECONFORM_ARGS+=(-strict)
fi
docker run --rm \
  -v /tmp/neurostore-k8s:/manifests \
  "${KUBECONFORM_IMAGE}" \
  "${KUBECONFORM_ARGS[@]}" \
  /manifests/base.yaml \
  /manifests/prod.yaml >/tmp/neurostore-k8s/kubeconform.txt
cat /tmp/neurostore-k8s/kubeconform.txt

echo "[6/6] Summary"
printf 'control_plane_host=%s\n' "${CONTROL_PLANE_HOST}"
printf 's3_host=%s\n' "${S3_HOST}"
printf 'strict=%s\n' "${STRICT}"
echo "k8s readiness checks passed"
