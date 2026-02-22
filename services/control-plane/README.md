# Control Plane (Option A)

`services/control-plane` is the no-token SaaS control-plane for Neurostore.

It provides:
- tenant project lifecycle
- macaroon token issuance/verification
- SigV4 access key issuance/revocation and internal resolution
- node registry and heartbeat scoring
- AI reliability scoring with anomaly penalties (latency spikes, proof/uptime drift)
- placement suggestions
- usage metering and billing estimates
- node payout previews
- health and metrics endpoints

## Run

```bash
cd services/control-plane
node server.mjs
```

Environment variables:
- `PORT` (default `8080`)
- `CONTROL_PLANE_DATA_DIR` (default `.tmp/control-plane`)
- `MACAROON_SECRET` (default `dev-secret-change-me`)
- `MAX_BODY_BYTES` (default `1048576`)
- `INTERNAL_API_TOKEN` (optional shared secret for internal-only endpoints like `/v1/sigv4/resolve`)
- `STATE_BACKEND` (`file` or `postgres`, default `file`)
- `DATABASE_URL` (required when `STATE_BACKEND=postgres`)
- `REDIS_URL` (optional cache when `STATE_BACKEND=postgres`)
- `STATE_REDIS_KEY` (default `neurostore:control-plane:state`)
- `STATE_PG_TABLE` (default `control_plane_state`)
- `STATE_MIRROR_FILE` (default `true`, keeps local JSON mirror)
- `STATE_BACKEND_FALLBACK_TO_FILE` (default `true`, graceful startup if PostgreSQL is not yet reachable)
- `AI_STALE_HEARTBEAT_MINUTES` (default `30`)
- `AI_TARGET_LATENCY_MS` (default `120`)

When running with PostgreSQL backend, this service uses `psql` and `redis-cli` binaries.

## Test

```bash
cd services/control-plane
node --test test/*.test.mjs
```

## API Summary

- `GET /healthz`
- `GET /readyz`
- `GET /metrics`
- `POST /v1/projects`
- `GET /v1/projects`
- `POST /v1/tokens/macaroon`
- `POST /v1/tokens/verify`
- `POST /v1/sigv4/keys`
- `GET /v1/sigv4/keys`
- `GET /v1/sigv4/keys/{access_key}`
- `POST /v1/sigv4/keys/revoke`
- `POST /v1/sigv4/resolve` (internal token recommended)
- `POST /v1/nodes/register`
- `POST /v1/nodes/heartbeat`
- `GET /v1/nodes`
- `GET /v1/nodes/{node_id}`
- `POST /v1/proofs/submit`
- `POST /v1/nodes/usage`
- `POST /v1/placement/suggest`
- `GET /v1/ai/placement/strategy?project_id=&period=YYYY-MM&objective=balanced|durability|latency|cost&object_size_mb=`
- `GET /v1/ai/nodes/risk?limit=`
- `GET /v1/ai/nodes/insights?limit=`
- `POST /v1/usage/ingest`
- `GET /v1/usage/{project_id}?period=YYYY-MM`
- `GET /v1/pricing/quote?tier=archive|active&storage_tb=&egress_tb=&api_million_ops=`
- `GET /v1/payouts/preview?period=YYYY-MM`
- `GET /v1/dashboard/summary?period=YYYY-MM`
