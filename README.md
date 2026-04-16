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
- `ADMIN_EMAILS` to a comma-separated list of operator accounts that may access admin routes

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

## Join the Swarm (Community Nodes)

You can contribute storage to the NeuroStore network and earn rewards by running a local node on your Windows machine.

### Windows One-Click Installer
1. Download `NeuroStore-Node-Installer.zip` from this repository.
2. Extract the folder to your computer.
3. Double-click `Install-NeuroStore.bat`.
4. Follow the GUI prompts to select your storage location and capacity.
5. Once installed, your browser will open the dashboard where you can claim your node and start earning.
6. After authentication, the desktop app persists its pairing locally and auto-starts with the system so the node can rejoin after reboot.

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

Desktop self-onboarding may also register with a per-node `claim_token`, but node claiming now verifies that the token matches the requested `node_id` before ownership is granted.

## Admin Telemetry Protection

- Admin inventory now redacts IP addresses, MAC addresses, device fingerprints, and host resource telemetry by default.
- Operators must explicitly request sensitive telemetry in the admin UI before those values are exposed.

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
