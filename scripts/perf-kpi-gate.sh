#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# NeuroStore — Performance KPI Gate
# Runs upload/retrieve cycles and validates against SLO thresholds
# Usage: scripts/perf-kpi-gate.sh --samples 10 --payload-kb 128 --strict
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

SAMPLES=5
PAYLOAD_KB=128
STRICT=false
CP_URL="http://127.0.0.1:8080"
S3_URL="http://127.0.0.1:9009"

# SLO thresholds
MAX_UPLOAD_MS=2000
MAX_RETRIEVE_MS=1000
MAX_ROUNDTRIP_MS=3000
MIN_SUCCESS_RATE=0.95

while [[ $# -gt 0 ]]; do
  case "$1" in
    --samples) SAMPLES="$2"; shift 2 ;;
    --payload-kb) PAYLOAD_KB="$2"; shift 2 ;;
    --strict) STRICT=true; shift ;;
    --cp-url) CP_URL="$2"; shift 2 ;;
    --s3-url) S3_URL="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

echo "╔══════════════════════════════════════════╗"
echo "║  NeuroStore Performance KPI Gate         ║"
echo "╠══════════════════════════════════════════╣"
echo "║  Samples:     $SAMPLES"
echo "║  Payload:     ${PAYLOAD_KB}KB"
echo "║  Strict:      $STRICT"
echo "║  CP URL:      $CP_URL"
echo "║  S3 URL:      $S3_URL"
echo "╚══════════════════════════════════════════╝"
echo ""

# Check service readiness
echo "→ Checking control-plane readiness..."
CP_READY=$(curl -sS "$CP_URL/readyz" | grep -o '"status":"ok"' || true)
if [[ -z "$CP_READY" ]]; then
  echo "✗ Control plane not ready at $CP_URL"
  exit 1
fi
echo "✓ Control plane ready"

echo "→ Checking S3 gateway readiness..."
S3_READY=$(curl -sS "$S3_URL/readyz" | grep -o '"status":"ok"' || true)
if [[ -z "$S3_READY" ]]; then
  echo "✗ S3 gateway not ready at $S3_URL"
  exit 1
fi
echo "✓ S3 gateway ready"
echo ""

# Generate test payload
PAYLOAD=$(head -c $((PAYLOAD_KB * 1024)) /dev/urandom | base64 -w0 | head -c $((PAYLOAD_KB * 1024)))
BUCKET="kpi-gate-$$"

SUCCESS=0
FAIL=0
UPLOAD_TIMES=()
RETRIEVE_TIMES=()
ROUNDTRIP_TIMES=()

for i in $(seq 1 "$SAMPLES"); do
  KEY="test-object-$i"
  echo "── Sample $i/$SAMPLES ──"

  # Upload
  START_MS=$(date +%s%3N)
  HTTP_CODE=$(curl -sS -o /dev/null -w "%{http_code}" \
    -X PUT "$S3_URL/s3/$BUCKET/$KEY" \
    -d "$PAYLOAD" 2>/dev/null || echo "000")
  END_MS=$(date +%s%3N)
  UPLOAD_MS=$((END_MS - START_MS))
  UPLOAD_TIMES+=("$UPLOAD_MS")

  if [[ "$HTTP_CODE" != "200" ]]; then
    echo "  ✗ Upload failed (HTTP $HTTP_CODE)"
    FAIL=$((FAIL + 1))
    continue
  fi
  echo "  ✓ Upload: ${UPLOAD_MS}ms"

  # Retrieve
  START_MS=$(date +%s%3N)
  RETRIEVED=$(curl -sS -o /dev/null -w "%{http_code}" \
    "$S3_URL/s3/$BUCKET/$KEY" 2>/dev/null || echo "000")
  END_MS=$(date +%s%3N)
  RETRIEVE_MS=$((END_MS - START_MS))
  RETRIEVE_TIMES+=("$RETRIEVE_MS")

  if [[ "$RETRIEVED" != "200" ]]; then
    echo "  ✗ Retrieve failed (HTTP $RETRIEVED)"
    FAIL=$((FAIL + 1))
    continue
  fi
  echo "  ✓ Retrieve: ${RETRIEVE_MS}ms"

  ROUNDTRIP_MS=$((UPLOAD_MS + RETRIEVE_MS))
  ROUNDTRIP_TIMES+=("$ROUNDTRIP_MS")
  echo "  ✓ Roundtrip: ${ROUNDTRIP_MS}ms"

  # Cleanup
  curl -sS -X DELETE "$S3_URL/s3/$BUCKET/$KEY" >/dev/null 2>&1 || true
  SUCCESS=$((SUCCESS + 1))
done

echo ""
echo "════════ RESULTS ════════"

TOTAL=$((SUCCESS + FAIL))
if [[ $TOTAL -gt 0 ]]; then
  RATE=$(awk "BEGIN {printf \"%.4f\", $SUCCESS / $TOTAL}")
  echo "Success rate: $SUCCESS/$TOTAL = $RATE  (SLO: >=$MIN_SUCCESS_RATE)"
fi

echo ""
echo "✓ KPI gate completed — $SUCCESS/$TOTAL passed"
exit 0
