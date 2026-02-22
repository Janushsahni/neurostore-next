#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-${ROOT_DIR}/deploy/.env.option-a.prod}"
OUT_DIR="${2:-${ROOT_DIR}/deploy/k8s/generated}"
NAMESPACE="${NAMESPACE:-neurostore}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "env file not found: ${ENV_FILE}" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

required_vars=(
  MACAROON_SECRET
  INTERNAL_API_TOKEN
  PRESIGN_SECRET
)
for var in "${required_vars[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    echo "missing required env var: ${var}" >&2
    exit 1
  fi
done

SIGV4_CREDENTIALS_JSON_VALUE="${SIGV4_CREDENTIALS_JSON:-[]}"
CONTROL_PLANE_HOST_VALUE="${CONTROL_PLANE_HOST:-api.neurostore.example.com}"
S3_HOST_VALUE="${S3_HOST:-s3.neurostore.example.com}"
TLS_SECRET_NAME_VALUE="${TLS_SECRET_NAME:-neurostore-edge-tls}"

mkdir -p "${OUT_DIR}"

cat > "${OUT_DIR}/control-plane-secret.yaml" <<YAML
apiVersion: v1
kind: Secret
metadata:
  name: control-plane-secret
  namespace: ${NAMESPACE}
type: Opaque
stringData:
  MACAROON_SECRET: "${MACAROON_SECRET}"
  INTERNAL_API_TOKEN: "${INTERNAL_API_TOKEN}"
YAML

cat > "${OUT_DIR}/s3-gateway-secret.yaml" <<YAML
apiVersion: v1
kind: Secret
metadata:
  name: s3-gateway-secret
  namespace: ${NAMESPACE}
type: Opaque
stringData:
  PRESIGN_SECRET: "${PRESIGN_SECRET}"
  INTERNAL_API_TOKEN: "${INTERNAL_API_TOKEN}"
  SIGV4_CREDENTIALS_JSON: '${SIGV4_CREDENTIALS_JSON_VALUE}'
YAML

cat > "${OUT_DIR}/ingress-patch.yaml" <<YAML
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: neurostore-edge
  namespace: ${NAMESPACE}
spec:
  tls:
    - hosts:
        - ${CONTROL_PLANE_HOST_VALUE}
        - ${S3_HOST_VALUE}
      secretName: ${TLS_SECRET_NAME_VALUE}
  rules:
    - host: ${CONTROL_PLANE_HOST_VALUE}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: control-plane
                port:
                  number: 80
    - host: ${S3_HOST_VALUE}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: s3-gateway
                port:
                  number: 80
YAML

cat > "${OUT_DIR}/kustomization.yaml" <<YAML
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: ${NAMESPACE}
resources:
  - ../base
patches:
  - path: control-plane-secret.yaml
  - path: s3-gateway-secret.yaml
  - path: ingress-patch.yaml
YAML

CERT_FULLCHAIN="${ROOT_DIR}/deploy/certs/fullchain.pem"
CERT_PRIVKEY="${ROOT_DIR}/deploy/certs/privkey.pem"
if [[ -f "${CERT_FULLCHAIN}" && -f "${CERT_PRIVKEY}" ]]; then
  CRT_B64="$(base64 -w 0 < "${CERT_FULLCHAIN}")"
  KEY_B64="$(base64 -w 0 < "${CERT_PRIVKEY}")"
  cat > "${OUT_DIR}/edge-tls-secret.yaml" <<YAML
apiVersion: v1
kind: Secret
metadata:
  name: ${TLS_SECRET_NAME_VALUE}
  namespace: ${NAMESPACE}
type: kubernetes.io/tls
data:
  tls.crt: ${CRT_B64}
  tls.key: ${KEY_B64}
YAML
  if ! grep -q "edge-tls-secret.yaml" "${OUT_DIR}/kustomization.yaml"; then
    awk '1; /resources:/ { print "  - edge-tls-secret.yaml" }' "${OUT_DIR}/kustomization.yaml" > "${OUT_DIR}/kustomization.yaml.tmp"
    mv "${OUT_DIR}/kustomization.yaml.tmp" "${OUT_DIR}/kustomization.yaml"
  fi
fi

echo "generated k8s manifests in ${OUT_DIR}"
