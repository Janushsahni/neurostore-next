# Option A Implementation Backlog

## Epic 1: S3 Gateway and Auth
- Build S3-compatible gateway (`PUT/GET/HEAD/DELETE/LIST`, multipart).
- Integrate macaroon auth caveats (bucket/prefix/op/expiry/IP).
- Add per-tenant quota and request rate limits.
- Deliver migration guide from AWS/MinIO clients.

## Epic 2: Metadata and Placement
- Implement metadata service for object->chunk->node mapping.
- Add Redis cache for hot metadata lookups.
- Add deterministic placement with region/ASN diversity constraints.
- Add idempotent write paths and manifest versioning.

## Epic 3: Proofs and Verifier
- Introduce proof scheduler with per-node challenge frequency.
- Add proof verifier with replay protection and freshness checks.
- Batch proofs with BLS aggregation.
- Add verifier audit logs and tamper-evident daily snapshots.

## Epic 4: Node Economics (Option A)
- Implement usage ledger (GB-hours, egress, ops).
- Implement payout calculator (quality multiplier and penalties).
- Add payout settlement pipeline for USDC and fiat rails.
- Add invoice generation for customers.

## Epic 5: AI MVP
- Reliability scoring from heartbeat/proof/latency features.
- Placement ranking model with explainability output.
- Isolation Forest anomaly pipeline for Sybil/drift signals.
- Canary release path for model versions.

## Epic 6: Operations
- Kubernetes manifests and Helm chart packaging.
- Canary releases with SLO gates.
- Dashboards: upload throughput, retrieval p95, proof pass rate.
- Chaos suite: node churn, network degradation, storage faults.

## Epic 7: Security and Compliance
- Threat model and security controls implementation matrix.
- API WAF, abuse detection, and DDoS protection.
- SOC 2 controls mapping and evidence automation.
- GDPR deletion and regional placement policy controls.

## Sprint Plan (12 Sprints, 2 weeks each)
1. Foundations: control-plane API, node registry, deployment scaffolding.
2. S3 auth path and tenant model.
3. Metadata writes/reads + Redis cache.
4. Upload orchestration and placement service.
5. Retrieval optimizer and fallback retry logic.
6. Proof scheduler/verifier with reporting.
7. Billing ledger and pricing calculator.
8. Payout preview + settlement integration adapters.
9. AI reliability scoring + anomaly job.
10. Dashboard + alerting + runbooks.
11. Security hardening + chaos tests.
12. Paid beta readiness, docs, and launch checklist.
