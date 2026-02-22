# AI Production Plan

## Phase 1 (MVP)
- Node reliability scoring from heartbeat/proof latency/uptime features.
- Placement ranking by score + region/ASN diversity.
- Anomaly detection with Isolation Forest-style outlier detection.

## Phase 2
- Data heat prediction for object-level access patterns.
- Hot-object cache placement at gateways and edge peers.

## Phase 3
- RL-guided adaptive redundancy by object class and SLO target.
- Autonomous repair orchestration using policy agents.

## Data pipeline
1. Collect telemetry from nodes, API gateway, proof verifier.
2. Stream to Kafka and persist curated features.
3. Train daily batch models and register model versions.
4. Canary deploy inference and compare with control policy.

## Inference targets
- placement decision latency: `<20ms p95`
- anomaly detection freshness: `<5 minutes`
- model rollback execution: `<2 minutes`
