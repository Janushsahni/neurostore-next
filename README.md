# NeuroStore

NeuroStore is a Rust-based decentralized storage gateway with erasure coding, encrypted shard placement, and S3-style object APIs.

## Quick Start

### 1. Configure environment

```bash
cp deploy/.env.example deploy/.env
```

Set strong values for required secrets in `deploy/.env`.
For production also set:
- `ENVIRONMENT=production`
- `ALLOWED_ORIGINS` to your public UI origins only
- `COOKIE_SECURE=true`

### 2. Start the stack

```bash
docker compose -f deploy/docker-compose.yml up --build -d
```

### 3. Validate deployment

```bash
scripts/deploy-readiness.sh
```

Run strict production checks:

```bash
scripts/deploy-readiness.sh --strict
```

### 4. Run performance gate

```bash
scripts/perf-kpi-gate.sh --strict
```

## Large Audience Rollout

Scale gateway replicas behind the load balancer:

```bash
docker compose -f deploy/docker-compose.yml up -d --scale neurostore-gateway=4
```

Re-run readiness and KPI checks after each scale step.

## Node Provider Security

Node registration requires shared-secret authentication:
- Header: `x-node-secret: <NODE_SHARED_SECRET>`
- Endpoint: `POST /api/nodes/register`

## Zero-Knowledge API Uploads

For true zero-knowledge object storage:
- encrypt file bytes on the client before `PUT /:bucket/:key`
- optionally attach sealed metadata in header `x-neuro-client-manifest`
- or upload sealed metadata after the object write with `POST /api/client-manifest/:bucket/:key`

The gateway stores client ciphertext as opaque bytes and does not retain a decryptable server-side file key for this flow.

## Key Paths

- `deploy/docker-compose.yml` - main deploy stack
- `scripts/deploy-readiness.sh` - functional readiness checks
- `scripts/perf-kpi-gate.sh` - latency and success KPI gate
- `docs/RUNBOOK_OPTION_A.md` - deployment runbook
- `docs/PERF_KPI_GATE.md` - KPI details

## Tech Stack

- Backend: Rust (`axum`, `sqlx`, `tokio`, `libp2p`)
- Metadata DB: PostgreSQL
- Cache/coordination: Redis
- Orchestration: Docker Compose
