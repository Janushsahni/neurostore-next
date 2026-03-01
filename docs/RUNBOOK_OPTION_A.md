# Deployment Runbook

This runbook covers the current production compose stack in this repository.

## 1. Prepare environment

```bash
cp deploy/.env.example deploy/.env
```

Set strong values for at least:

- `POSTGRES_PASSWORD`
- `METADATA_SECRET`
- `JWT_SECRET`
- `PROOF_SUBMIT_TOKEN`
- `COMPLIANCE_SIGNING_KEY`
- `MACAROON_SECRET`
- `NODE_SHARED_SECRET`

For internet-facing deployments, set `COOKIE_SECURE=true`.
Also set:
- `ENVIRONMENT=production`
- `ALLOWED_ORIGINS` to only your trusted frontend domains.

## 2. Start stack

```bash
docker compose -f deploy/docker-compose.yml up --build -d
```

## 3. Verify deployment

```bash
scripts/deploy-readiness.sh
```

Strict production policy checks:

```bash
scripts/deploy-readiness.sh --strict
```

## 4. Run KPI gate

```bash
scripts/perf-kpi-gate.sh --strict
```

## 5. Scale for larger audience

Increase gateway replicas behind the load balancer:

```bash
docker compose -f deploy/docker-compose.yml up -d --scale neurostore-gateway=4
```

Then re-run readiness and KPI gate.

## 6. Large-audience load test

Example with `autocannon` against gateway LB:

```bash
npx autocannon -c 200 -d 120 http://127.0.0.1:9009/readyz
```

For authenticated object traffic, use `scripts/perf-kpi-gate.sh` with higher `--samples` and payload sizes.

## 7. Node onboarding security

Provider registration requires shared-secret auth:

```bash
curl -sS -X POST http://127.0.0.1:9009/api/nodes/register \
  -H "content-type: application/json" \
  -H "x-node-secret: ${NODE_SHARED_SECRET}" \
  -d '{
    "peer_id":"12D3KooW...",
    "wallet_address":"0x1111111111111111111111111111111111111111",
    "capacity_gb":500,
    "declared_location":"IN-KA"
  }'
```
