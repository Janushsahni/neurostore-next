# NeuroStore AI Project Brief

This file is a compact map for AI coding agents. Read this first before scanning the full repository.

## Product Goal

NeuroStore is a decentralized storage network. Users upload encrypted files through a gateway; files are split into chunks/shards; community devices run `neuro-node` to store encrypted shard files and earn rewards based on uptime, capacity, and verified storage/bandwidth activity.

The production goal is a real-world storage marketplace:
- reliable node onboarding on Windows, Linux, and macOS
- visible live node status in the frontend after install/startup
- encrypted chunk storage on device disks
- durable gateway metadata in PostgreSQL
- operator/admin inventory with safe telemetry redaction
- S3-compatible upload/download flows
- readiness, KPI, and security checks before deployment

## Main Architecture

- `crates/gateway`: Rust Axum API gateway. Handles auth, S3-style object APIs, node registration, heartbeats, earnings, admin inventory, shard metadata, and compliance controls.
- `crates/node`: Rust storage node binary named `neuro-node`. Creates node identity, registers with the gateway, sends heartbeats, creates a locked storage vault, and stores encrypted `.neuro` shard files.
- `frontend`: React/Vite dashboard. Shows network stats, node operator telemetry, node claiming, object explorer, pricing, compliance, and admin pages.
- `deploy`: Docker, systemd, launchd, Windows service, nginx, and production deployment files.
- `scripts`: readiness, smoke, benchmark, build, and operations scripts.
- `docs`: architecture, API, production runbook, security, compliance, pricing, and backlog documents.

## Critical Runtime Flow

1. Device owner installs or starts `neuro-node`.
2. The node loads config from CLI flags or `--setup-config-path`.
3. The node creates/loads a persistent libp2p identity and derives a dashboard ID like `NEURO-XXXXXXXX`.
4. The node creates a storage vault at `<storage_path>/<node_id>/vault`.
5. The node registers with `POST /api/nodes/register`.
6. The gateway seeds `node_registry` and stores claim metadata.
7. The node sends heartbeat telemetry to `POST /api/nodes/heartbeat` every 45 seconds.
8. The gateway uses heartbeats and a flush buffer to update active status, used GB, shard count, earnings, and last heartbeat time.
9. The frontend reads `/api/nodes/stats`, `/api/my/nodes`, `/api/nodes/explorer`, and `/api/node/:node_id/earnings`.

If the frontend does not show a node as active, check in this order:
- service command matches supported `neuro-node` CLI flags
- systemd/launchd/Windows service is actually running
- `journalctl -u neuro-node -f` or service logs show registration/heartbeat success
- gateway URL is correct and reachable from the device
- `node_registry.last_heartbeat_at` is recent
- frontend API base points to the same gateway

## Production Readiness Priorities

- Keep installer/service commands aligned with `crates/node/src/main.rs` CLI definitions.
- Never break persistent identity paths; changing identity location changes node ID.
- Treat heartbeat cache as an overlay, not the only source of truth.
- Avoid exposing IP, MAC, hostname, or device fingerprint unless explicitly requested by an admin.
- Keep upload/download paths zero-knowledge where possible: client encrypts before upload, gateway stores opaque ciphertext.
- Validate new deployment changes with:`
  - `cargo check --target-dir target-codex-verify -p neuronode`
  - `cargo check --target-dir target-codex-verify -p neuro-gateway`
  - `npm run build` from `frontend`
  - `scripts/deploy-readiness.sh --strict` against a deployed stack
  - `scripts/perf-kpi-gate.sh --strict` for performance gates

## High-Signal Files

- `crates/node/src/main.rs`: node CLI and runtime config loading.
- `crates/node/src/lib.rs`: node identity, registration, heartbeat loop, vault startup.
- `crates/node/src/store.rs`: encrypted shard file storage.
- `crates/gateway/src/handlers/nodes.rs`: node registration, heartbeats, stats, earnings, claiming, admin inventory.
- `crates/gateway/src/handlers/s3.rs`: object upload/download and shard placement.
- `frontend/src/pages/NodeDashboard.jsx`: node operator dashboard and active status display.
- `deploy/systemd/install-node-service.sh`: Linux production node installer.
- `deploy/systemd/neuro-node.service`: Linux service unit.
- `README.md`: human quick start.
- `docs/RUNBOOK_OPTION_A.md`: production deployment runbook.

## Current Mental Model

This repo is not only a frontend. The user-facing active-node state depends on a chain:

`installer command -> neuro-node process -> gateway registration -> heartbeat -> node_registry/cache -> frontend polling`

When fixing active-status bugs, do not only edit UI text. Verify the process can start, register, heartbeat, persist status, and be read by the frontend.
