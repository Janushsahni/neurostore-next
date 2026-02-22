# Neurostore Option A Production Project

## 1. Product Definition

### Product names
- AegisStore
- ProofMesh Cloud
- Neurostore Edge

### Core value proposition
- S3-compatible decentralized object storage with client-held keys, verifiable custody, and lower blended cost than centralized clouds for egress-heavy and archive workloads.

### Target customers
- Web3 infrastructure teams (indexers, NFT/media backends, RPC archive providers).
- AI teams storing datasets, checkpoints, and model artifacts.
- Enterprises needing encrypted multi-region backups with policy controls.
- Backup/archival MSPs and SaaS vendors.

### Positioning
- vs AWS S3: lower blended storage+egress cost and cryptographic custody verification.
- vs Filecoin: lower integration complexity, deterministic API behavior, faster retrieval UX.
- vs Storj: stronger provider scoring + automated repair loop.
- vs Arweave: mutable object storage and active retrieval, not permanent-only write-once economics.

## 2. MVP Scope (4-6 Months)

### Must-have
- S3-compatible gateway APIs (PUT/GET/HEAD/DELETE/LIST + multipart).
- Client-side encryption SDK (`AES-256-GCM`).
- Reed-Solomon erasure coding pipeline (`k/m` configurable).
- Provider node daemon (Rust) with quota and proof scheduler.
- Lightweight storage proofs (challenge-response + signed replies).
- AI MVP:
  - reliability scoring
  - placement optimization
  - anomaly detection (Isolation Forest equivalent policy path)
- Payment Option A:
  - off-chain credits and invoices
  - node payouts in fiat/USDC
- Dashboard:
  - usage
  - node earnings
  - health/proof metrics

### Excluded to Phase 2+
- RL consensus switching.
- Federated learning.
- CDN-grade hot replication everywhere.
- Full multi-agent autonomy.

## 3. System Architecture

### Text architecture diagram
```text
[Web App / CLI / SDKs]
        |
    HTTPS (S3 + REST)
        v
[API Gateway/Auth + Macaroons]
        |
        +--> [Metadata Service] ----> [PostgreSQL (Citus)]
        |              |                    |
        |              +--> [Redis cache] <-+
        |
        +--> [Upload Orchestrator] --> [Erasure Service] --> [Chunk Router] --> [Provider Nodes]
        |
        +--> [Retrieval Optimizer] --------------------------------------------> [Provider Nodes]
        |
        +--> [Proof Scheduler] --> [Provider Nodes] --> [Proof Verifier + BLS Aggregator]
        |
        +--> [Pricing + Billing + Payout Engine] --> [USDC/Fiat rails]

Telemetry:
[Nodes + APIs] -> [OTel Collector] -> [NATS JetStream + Kafka] -> [Feature Store] -> [ML Inference]
                                                                         |
                                                                     [Training loop]
```

### Control plane services
- API gateway and auth.
- Metadata service (`CID -> shard map`).
- Node registry.
- Pricing and billing.
- Proof verifier.
- Telemetry ingest + ML inference.

### Data plane services
- Chunk router.
- Erasure encoder/decoder.
- Retrieval optimizer.
- Repair orchestrator.

## 4. Microservices Layout
- `api-gateway`
- `s3-gateway`
- `auth-macaroon`
- `metadata-service`
- `node-registry`
- `placement-service`
- `upload-orchestrator`
- `erasure-service`
- `chunk-router`
- `retrieval-optimizer`
- `proof-scheduler`
- `proof-verifier`
- `repair-orchestrator`
- `pricing-engine`
- `billing-service`
- `payout-service`
- `telemetry-ingest`
- `ml-inference`
- `dashboard-bff`

## 5. Tech Stack

| Layer | Production Stack |
|---|---|
| Provider daemon | Rust + Tokio + libp2p |
| Control plane API | Node.js (current starter) -> Go/Rust hardened service by GA |
| Data services | Rust/Go microservices via gRPC |
| Metadata | PostgreSQL (+ Citus for scale) |
| Cache | Redis |
| Event bus | NATS JetStream |
| Analytics stream | Kafka/Redpanda |
| Object crypto | AES-256-GCM, HKDF |
| Signature/proofs | BLS aggregation + challenge-response |
| Content addressing | CIDv1 + BLAKE2b-512 |
| Deploy | Kubernetes + Helm + ArgoCD |
| Observability | OpenTelemetry + Prometheus + Grafana |

## 6. API Surface

### Public
- S3-compatible:
  - `PUT /s3/{bucket}/{key}`
  - `GET /s3/{bucket}/{key}`
  - `HEAD /s3/{bucket}/{key}`
  - `DELETE /s3/{bucket}/{key}`
  - multipart endpoints (`?uploads`, `?uploadId`, `?partNumber`)
  - `POST /v1/presign`
- REST:
  - `POST /v1/projects`
  - `POST /v1/tokens/macaroon`
  - `POST /v1/sigv4/keys`
  - `POST /v1/sigv4/keys/revoke`
  - `GET /v1/usage/{project_id}`
  - `GET /v1/pricing/quote`
  - `GET /v1/dashboard/summary`

### Node/ops
- `POST /v1/nodes/register`
- `POST /v1/nodes/heartbeat`
- `POST /v1/proofs/submit`
- `POST /v1/nodes/usage`
- `GET /v1/payouts/preview`

### Internal gRPC contracts
- `RegisterNode`
- `ReservePlacement`
- `SubmitChunkReceipt`
- `IssueProofChallenge`
- `SubmitProof`
- `TriggerRepair`

## 7. Upload/Download Data Flows

### Upload
1. Client encrypts object locally (`AES-256-GCM`).
2. SDK chunks and erasure-encodes (`k=16,m=6` default profile).
3. Per-shard CID is generated.
4. Placement service selects node targets by score and diversity.
5. Chunk router uploads shards in parallel.
6. Node returns signed receipt.
7. Metadata commits mapping and schedules proofs.

### Download
1. Client requests object (macaroon scoped).
2. Retrieval optimizer selects fastest healthy `k` shards.
3. Parallel fetch from nodes.
4. Verify signatures/CIDs.
5. Decode and decrypt client-side.
6. Trigger async repair for missing shards.

## 8. Node Lifecycle Flow
1. Register node and run baseline benchmark.
2. Probation state with higher proof frequency.
3. Promote to active after stable score.
4. Degrade/suspend on failed proofs or poor latency.
5. Recover after sustained healthy heartbeats.
6. Exit flow drains shards and closes payouts.

## 9. Repair Flow
1. Health detector flags under-redundant shard set.
2. Repair orchestrator fetches remaining `k` shards.
3. Reconstructs missing shards.
4. Re-places to healthy nodes.
5. Verifies receipts/proofs.
6. Updates metadata and closes incident.

## 10. AI Pipeline Flow
1. Ingest node telemetry and proof results.
2. Generate reliability and anomaly features.
3. Retrain daily (MVP simple models).
4. Canary model rollout.
5. Online inference in placement path (`<20ms p95`).
6. Feedback from repair/retrieval outcomes.

## 11. Cryptography and Trust
- Client-side key ownership only.
- Macaroons for scoped delegated access.
- Lightweight proof-of-storage in MVP:
  - random challenge
  - deterministic response hash
  - signed response
- BLS aggregation for verifier batching.
- ZK strategy:
  - MVP: challenge-response + signed verifier roots
  - Phase 2: batch zk-verification for verifier state transitions

## 12. Performance and SLA Targets
- Upload throughput per node: `40-80 MB/s` on commodity 1GbE.
- Retrieval latency: `p95 < 350ms` active tier, `p95 < 2.5s` archive tier.
- Durability: `11 nines` logical target.
- Churn tolerance: service SLO sustained under `25%` daily transient churn.
- Repair start: `<2 minutes`.
- Repair completion: `95% <30 minutes`.
- Overhead ratio: default `22/16 = 1.375x`.

## 13. DevOps and Deployment
- Kubernetes multi-region control plane.
- CI/CD: lint, test, integration, image signing, canary rollout.
- Observability: Prometheus, Grafana, OpenTelemetry.
- Chaos testing: node kill, latency injection, partition, metadata failover.
- Environments:
  - local sandbox (Docker multi-node)
  - testnet
  - mainnet

## 14. Security and Compliance

### Threat model
- Sybil providers.
- proof replay/forgery.
- data withholding.
- API abuse and DDoS.
- supply chain compromise.

### Controls
- provider deposit and probation scoring.
- nonce-based proof replay prevention.
- signed responses and freshness windows.
- API rate limits and WAF.
- container hardening and least privilege.

### Compliance roadmap
- GDPR controls by paid beta.
- SOC 2 Type I by GA, Type II evidence window thereafter.
- HIPAA optional tier after enterprise isolation controls.

## 15. Tokenomics/Pricing (Option A)
- No token.
- Pricing:
  - Archive: `$7/TB-month` + `$8/TB` egress.
  - Active: `$11/TB-month`, lower egress tariff.
- Node payouts: weekly fiat/USDC.
- Revenue model: SaaS invoicing + committed-use contracts.

## 16. Cost Model

### Unit economics formula
`COGS/TB = (n/k * provider_storage_cost) + control_plane_cost + repair_reserve + settlement_cost`

Example:
- `1.375 * 2.4 + 1.2 + 0.6 + 0.3 = $5.4/TB`
- archive sale price around `$7.8/TB` effective yields positive gross margin.

### Node ROI example
- 60TB raw, 42TB utilized.
- $120-$140 monthly payout.
- $60-$80 monthly operator cost.
- target 35-45% operator margin.

## 17. Go-To-Market
- ICP: teams with `100TB-10PB` footprint and egress-sensitive bills.
- First verticals:
  - AI datasets
  - Web3 infra storage
  - compliance archive backup
- Dev adoption:
  - free credits
  - S3 migration tooling
  - reference SDK templates
- Open-source:
  - node daemon + SDK + CLI + protocol
- Proprietary:
  - global scheduler, advanced policy engine, billing analytics

## 18. 12-Month Timeline (Gantt)

```text
Phase 0  Prototype hardening      Mar-Apr 2026   ██████
Phase 1  MVP testnet              May-Aug 2026       ████████████
Phase 2  Paid beta                Sep-Oct 2026                    ██████
Phase 3  Mainnet GA               Nov-Dec 2026                          ██████
Phase 4  Enterprise extensions    Jan-Feb 2027                               ██████
```

## 19. Hiring Plan
- Backend/platform: 5
- Distributed systems/node: 4
- ML/data: 2
- DevOps/SRE: 3
- Security/compliance: 2
- Product/DevRel/solutions: 3
- Total: 19
