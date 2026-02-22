# Neurostore Next

Next-generation decentralized storage MVP with a full protocol loop: client-side sharding/encryption, signed storage receipts, retrieval proofs, deterministic multi-peer placement, challenge audits, and recovery/decryption.

## Crates

- `crates/node` - libp2p node (Kademlia, Gossipsub, Noise, chunk command protocol)
- `crates/client-sdk` - chunk/encrypt/erasure/hash pipeline + recovery
- `crates/client-wasm` - browser WASM bindings
- `crates/protocol` - shared protocol messages and receipt/proof/audit verification helpers
- `crates/uploader` - CLI with `upload`, `retrieve`, `audit`, `validate`, `migrate-manifest`, and `autopilot` subcommands
- `crates/sentinel` - reputation scoring CLI

## Production Project (Option A)

`Option A` is the no-token SaaS path (pay-per-GB/TB, fiat/USDC payouts).

Production starter artifacts:
- `services/control-plane` - API service for projects, macaroon tokens, node registry/health, placement suggestions, usage metering, and payout previews
- `services/s3-gateway` - S3-compatible path-style gateway with multipart upload, presigned URLs, SigV4 verification, and control-plane auth/metering integration
- `deploy/docker-compose.option-a.yml` - local production-like stack (control-plane, nodes, postgres, redis, nats, redpanda, observability)
- `deploy/k8s/base` - Kubernetes manifests (namespace, deployment, service, HPA, network policy)
- `docs/PRODUCTION_OPTION_A_PROJECT.md` - complete product + architecture + SLA + GTM + roadmap package
- `docs/IMPLEMENTATION_BACKLOG.md` - execution backlog and sprint sequencing
- `docs/RUNBOOK_OPTION_A.md` - end-to-end local runbook (project, token, upload/download/list, usage, payouts)

Quick start for Option A control-plane:
```bash
cd services/control-plane
node server.mjs
```

Run control-plane tests:
```bash
cd services/control-plane
node --test test/*.test.mjs
```

Run s3-gateway tests:
```bash
cd services/s3-gateway
node --test test/*.test.mjs
```

Bring up the full local stack:
```bash
docker compose -f deploy/docker-compose.option-a.yml up --build
docker compose --env-file deploy/.env.option-a.prod -f deploy/docker-compose.option-a.yml up --build -d
docker compose --env-file deploy/.env.option-a.prod -f deploy/docker-compose.option-a.yml -f deploy/docker-compose.edge.yml up --build -d
```

Run deploy readiness checks (local or pre-release gate):
```bash
scripts/deploy-readiness.sh
scripts/deploy-readiness.sh --strict
scripts/k8s-readiness.sh --strict
scripts/perf-kpi-gate.sh
scripts/perf-kpi-gate.sh --strict
```

## Full Loop Quick Start

1. Build WASM UI:
```bash
wasm-pack build crates/client-wasm --target web --out-dir web/pkg
python3 -m http.server 5173 -d web
```

Optional local secure node API (for browser upload testing):
```bash
node scripts/local-node-api.mjs
```
This endpoint stores only encrypted shards from the browser pipeline and exposes AI health metrics at `GET /api/metrics`.

2. Start node:
```bash
cargo run -p neuro-node -- --storage-path ./node-data --max-gb 25 --listen /ip4/0.0.0.0/tcp/9000
```
The node now persists identity at `node-data/node_identity.key` so peer ID is stable across restarts.
Optional network hardening:
```bash
--bootstrap /ip4/10.0.0.10/tcp/9000/p2p/<BOOTSTRAP_PEER_ID>
--allow-peer <TRUSTED_PEER_ID>
```

Interactive first-run setup (prompts for storage path + allocation and saves config):
```bash
cargo run -p neuro-node -- --interactive-setup
```
Saved setup config path:
- Windows: `%APPDATA%\Neurostore\node-config.json`
- Linux/macOS: `$XDG_CONFIG_HOME/neurostore/node-config.json` (or `~/.config/neurostore/node-config.json`)

Windows `.exe` bundle:
- Build artifact workflow: `.github/workflows/node-windows-release.yml`
- Latest download URL: `https://github.com/Janushsahni/neurostore-next/releases/latest/download/neuro-node-windows-x86_64.zip`
- End-user run command: `start-node.bat`
- Windows installer URL: `https://github.com/Janushsahni/neurostore-next/releases/latest/download/neuro-node-windows-x86_64.msi`
- Service installer command: `install-service.bat` (run as Administrator)
- Show node share address: `show-node-address.bat`
- Guided upload helper: `upload-image.bat`
- Guided retrieve helper: `retrieve-image.bat`
- Local website launcher: `start-demo-portal.bat` (requires Node.js 20+)
- Auto-update task installer: `install-updater-task.bat` (run as Administrator)
- Update manifest URL: `https://github.com/Janushsahni/neurostore-next/releases/latest/download/neuro-node-update.json`
- Checksums URL: `https://github.com/Janushsahni/neurostore-next/releases/latest/download/SHA256SUMS.txt`

Windows service internals:
- Node service mode flag: `--run-as-service`
- Service display name defaults to `NeurostoreNode`
- Service installer script path: `deploy/windows/install-service.ps1`
- Service uninstall script path: `deploy/windows/uninstall-service.ps1`
- Share address helper path: `deploy/windows/show-node-address.ps1`
- Upload helper path: `deploy/windows/upload-image.ps1`
- Retrieve helper path: `deploy/windows/retrieve-image.ps1`
- Local website launcher path: `deploy/windows/start-demo-portal.ps1`
- Auto-update script path: `deploy/windows/update-node.ps1`
- Auto-update task install script: `deploy/windows/install-updater-task.ps1`
- Auto-update task uninstall script: `deploy/windows/uninstall-updater-task.ps1`
- Auto-update task uninstall helper: `deploy/windows/uninstall-updater-task.bat`

Windows multi-laptop AI verification script:
- Script path: `deploy/windows/multi-laptop-test.ps1`
- Batch launcher: `deploy/windows/multi-laptop-test.bat`
- Sample nodes file: `examples/windows-multi-laptop-nodes.sample.json`
- Example:
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/windows/multi-laptop-test.ps1 `
  -ControlPlaneUrl "http://127.0.0.1:8080" `
  -NodesFile "examples/windows-multi-laptop-nodes.sample.json" `
  -ReplicaCount 2 `
  -Objective latency `
  -DegradeNodeId "laptop-node-1"
```
The script registers nodes, sends healthy heartbeats, injects one degraded node heartbeat/proof failure, and writes AI before/after artifacts (`risk`, `placement`, `summary`) under `artifacts/multi-laptop-test/<timestamp>/`.

Localhost web portal (no CLI for uploader flow):
- Server path: `apps/demo-portal/server.mjs`
- Browser URL: `http://127.0.0.1:7070`
- Windows launcher: `deploy/windows/start-demo-portal.bat`
- API features:
  - local account register/login
  - strict client-side encryption in browser before upload
  - server only receives encrypted shards (`store-prepared` path)
  - retrieve encrypted shards then decrypt in browser (passphrase never sent)
  - per-user object list and recovered-file download
  - image/doc/pdf upload from browser (no uploader CLI needed for end users)

Crypto modes:
- `wasm-rs` (preferred): full browser-side RS sharding via `neuro-client-wasm` package if present under `apps/demo-portal/public/pkg/`
- `js-aes-replica` (fallback): browser-side AES-256-GCM + replicated encrypted shard placement (strict no-plaintext mode preserved)

Start locally:
```bash
node apps/demo-portal/server.mjs
```
Windows:
```powershell
deploy\\windows\\start-demo-portal.bat
```

Three-laptop demo using portal:
1. Each friend installs node MSI and runs `install-service.bat`.
2. Each friend runs `show-node-address.bat` and shares `/ip4/<IP>/tcp/9000/p2p/<PEER_ID>`.
3. Host runs portal and (optional) exposes it with `ngrok http 7070`.
4. Uploader opens portal URL, creates account, logs in, pastes peer addresses, uploads image/doc/pdf directly in browser.
5. Browser encrypts locally; portal server never sees plaintext file.
6. Turn off one node laptop.
7. Uploader clicks `Retrieve + Decrypt` in portal and enters passphrase to download recovered file.

Public portal via ngrok (host machine):
```bash
node apps/demo-portal/server.mjs
ngrok http 7070
```
Share the `https://...ngrok...` URL with users. They only need browser login/upload access.

Previous CLI demo flow (still supported):
1. Each laptop: install `.msi`, run `install-service.bat`, then run `show-node-address.bat` and share the generated `/ip4/<IP>/tcp/9000/p2p/<PEER_ID>`.
2. Uploader laptop: run `upload-image.bat`, provide image path, passphrase, and all peer multiaddrs.
3. Turn off one friend laptop.
4. Uploader laptop: run `retrieve-image.bat` with the same manifest and passphrase; compare file hash with original.

Optional release code-signing secrets for GitHub Actions:
- `WINDOWS_CODESIGN_PFX_B64` (base64-encoded PFX certificate)
- `WINDOWS_CODESIGN_PASSWORD` (PFX password)

3. Upload with deterministic replica placement:
```bash
cargo run -p neuro-uploader -- upload \
  --file ./path/to/image.png \
  --password "vault-passphrase" \
  --peer /ip4/127.0.0.1/tcp/9000/p2p/<NODE_PEER_ID> \
  --manifest-out manifest.json \
  --profile balanced \
  --replica-factor 2 \
  --audit-rounds 3 \
  --max-response-age-secs 120 \
  --report-out upload-report.json
```

Optional scoring sources:
```bash
--peer-score '/ip4/127.0.0.1/tcp/9000/p2p/<NODE_PEER_ID>=85'
--telemetry-file ./peer-telemetry.json
```
`--telemetry-file` supports:
- raw metrics rows (`latency_ms`, `uptime_pct`, `verify_success_pct`)
- AI policy rows (`reputation`, `confidence`) from `neuro-sentinel`

`peer-telemetry.json` format:
```json
[
  {
    "peer": "/ip4/127.0.0.1/tcp/9000/p2p/<NODE_PEER_ID>",
    "latency_ms": 120.0,
    "uptime_pct": 99.2,
    "verify_success_pct": 98.8
  }
]
```
Example file: `examples/peer-telemetry.json`
AI policy example: `examples/telemetry-policy.json`

Sentinel adaptive policy stream example:
```bash
echo '{"peer":"peer-a","latency_ms":120,"uptime_pct":99.8,"verify_success_pct":98.7}' | \
  cargo run -p neuro-sentinel -- --mode adaptive
```

4. Retrieve and reconstruct with fallback retries:
```bash
cargo run -p neuro-uploader -- retrieve \
  --manifest manifest.json \
  --password "vault-passphrase" \
  --out restored.png \
  --max-response-age-secs 120 \
  --report-out retrieve-report.json
```

5. Run challenge audits:
```bash
cargo run -p neuro-uploader -- audit \
  --manifest manifest.json \
  --password "vault-passphrase" \
  --sample 12 \
  --max-response-age-secs 120 \
  --report-out audit-report.json
```

6. Validate manifest integrity without retrieval:
```bash
cargo run -p neuro-uploader -- validate \
  --manifest manifest.json \
  --password "vault-passphrase" \
  --report-out validate-report.json
```

7. Migrate legacy manifest to current format:
```bash
cargo run -p neuro-uploader -- migrate-manifest \
  --input old-manifest.json \
  --output manifest.json \
  --password "vault-passphrase"
```

8. Run closed-loop autopilot repair from AI policy output:
```bash
cargo run -p neuro-uploader -- autopilot \
  --manifest manifest.json \
  --password "vault-passphrase" \
  --policy-file examples/telemetry-policy.json \
  --replica-factor 2 \
  --quarantine-reputation 40 \
  --min-confidence 0.5 \
  --max-response-age-secs 120 \
  --report-out autopilot-report.json
```
`autopilot` quarantines bad peers, re-replicates under-replicated shards, updates the manifest, and emits a signed action report.
It applies quarantine transactionally per shard to avoid availability regressions (keeps original placement if healthy target repair cannot be completed).

Policy row format (JSON array):
```json
[
  {
    "peer": "/ip4/127.0.0.1/tcp/9000/p2p/<PEER_ID>",
    "reputation": 92.4,
    "confidence": 0.87,
    "anomaly": false,
    "recommendation": "accept"
  }
]
```

## Protocol

- Unified protocol: `/neurostore/chunk/2.0.0`
- Commands: `STORE`, `RETRIEVE`, `AUDIT`
- Replies: signed storage receipt, signed retrieval proof, signed audit response
- Client verifies signatures and CID/hash invariants before accepting data
- Response freshness windows enforced by client (`max-response-age-secs`)
- Manifest includes password-bound authentication tag to detect tampering

## Next-Gen Mechanics Included

- Adaptive erasure profiles (`mobile`, `balanced`, `resilient`)
- Deterministic shard placement with replica fanout and peer scoring
- Manifest integrity hash and Merkle root checks
- Retrieval fallback across ranked peer candidates
- Challenge-response audits using precomputed audit vectors
- Node-side audit replay protection for per-request nonces
- AI-policy-driven closed-loop autopilot quarantine and re-replication
- Mobile-first node map with animated shard-flow and trace panels
- Stable node identity persisted on disk for deterministic peer ID
- Storage quota enforcement on encrypted chunk writes
- JSON operation reports (`upload`, `retrieve`, `audit`, `validate`)
- Manifest migration command for legacy metadata
- Node bootstrap peers and peer allowlist controls

## Safety Limits

- Max manifest size: `16 MB`
- Max shards per manifest: `250,000`
- Max peer targets per shard: `64`
- Max audit rounds per shard: `64`

## Build Modes

Online bootstrap (one-time on a machine with internet):
```bash
scripts/bootstrap-online.sh
```

Offline build/test (after vendoring):
```bash
scripts/build-offline.sh
```

Full protocol integration harness (3 nodes + upload + audit + autopilot + retrieve):
```bash
scripts/full-loop-integration.sh
```

Switch dependency source:
```bash
scripts/use-vendored.sh
scripts/use-crates-io.sh
```

## Cross-Platform Apps

Native cross-platform shell is in `apps/tauri-shell` and targets:
- Windows
- macOS
- iOS
- Android

Quick start:
```bash
cd apps/tauri-shell
npm install
npm run dev
```

Build:
```bash
scripts/platform-build.sh desktop
scripts/platform-build.sh ios
scripts/platform-build.sh android
```

Platform details:
- `apps/tauri-shell/README.md`

## Filecoin Comparison

Short answer: **not yet better than Filecoin overall**.

Where this project is currently stronger:
- Simpler developer flow for app-centric encrypted object storage.
- Client-first cryptographic pipeline with explicit retrieval fallback.
- Flexible protocol evolution velocity (you can ship changes quickly).

Where Filecoin is currently stronger:
- Proven production scale, economic security, and market liquidity.
- Mature proof systems and long-term data-availability guarantees.
- Ecosystem depth: retrieval markets, tooling, operators, and audits.

Startup positioning:
- Treat this as a differentiated protocol stack for specific product UX/performance goals.
- Do not market as a wholesale Filecoin replacement yet.
