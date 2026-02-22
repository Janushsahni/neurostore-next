# Competitive Strategy: Beating Incumbents in Our Segment

This project should not try to beat Filecoin on its strongest axis first (global economic security + long-run proving market). It should win an adjacent but high-value segment first and then expand.

## Reality Check

- Filecoin storage providers face collateral and slashing economics that shape provider behavior and risk appetite.
- Storj pushes hard on S3 compatibility and easy migration.
- Arweave pushes permanence with a different economic model (pay once, store forever).

Sources:
- https://docs.filecoin.io/storage-providers/filecoin-economics/fil-collateral
- https://docs.filecoin.io/storage-providers/filecoin-economics/committed-capacity
- https://storj.dev/
- https://storj.dev/dcs/api/s3/s3-compatibility
- https://www.arweave.com/

## Win Thesis

We win by becoming the best platform for:
- Encrypted application data with low-latency retrieval and deterministic reliability.
- AI-assisted operations that reduce operator complexity and failure rates.
- Developer experience that is easier than market alternatives for app teams.

## AI-First Product Wedges

1. Predictive reliability and dynamic placement
- Continuously learn node reliability from latency/uptime/verification and allocate shards proactively.
- Already in progress: adaptive scoring and anomaly policy in `neuro-sentinel`.

2. Autonomous remediation
- Detect anomalous peers and trigger quarantine + automatic re-replication.
- Add closed-loop actions based on audit failures and retrieval retries.

3. Retrieval SLO optimizer
- Train route/replica selection around p95/p99 latency SLOs by region.
- Reward low-tail-latency peers and penalize volatile peers.

4. Operator copilot
- Explain why a peer was promoted/quarantined, with confidence and counterfactuals.
- Turn protocol complexity into clear actions for ops teams.

## Product KPIs (must beat alternatives in our niche)

- p95 retrieve latency <= 400ms (regional), p99 <= 900ms.
- Successful retrieve rate >= 99.95% monthly for pinned datasets.
- Mean-time-to-repair after peer degradation <= 2 minutes.
- Time-to-first-integration (S3-compatible client) <= 15 minutes.
- Infra cost per TB retrievable at least 30% below target incumbents in target segment.

## 90-Day Execution

1. Reliability loop
- Wire sentinel outputs into uploader placement decisions directly.
- Add automatic quarantine and re-replication paths.

2. S3 gateway compatibility path
- Add compatibility layer and migration tooling for existing buckets.

3. Enterprise readiness
- Tenant isolation, API keys, auditable logs, and policy controls.

4. Commercialization
- Launch with 2-3 verticals where low-latency encrypted retrieval matters (AI datasets, media workflows, compliance archives).

## Positioning

- Do not claim "better than Filecoin globally" yet.
- Claim "better for low-latency encrypted app data workflows" and prove with public benchmark dashboards.
