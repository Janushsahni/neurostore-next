# Security Threat Model (Option A)

## Assets
- encrypted shard data
- metadata mapping (object -> shard -> node)
- tenant auth tokens
- billing and payout ledgers
- node identity keys and proof records

## Trust boundaries
- client device (trusted for encryption/decryption)
- control-plane APIs (authenticated, rate limited)
- provider node network (semi-trusted, adversarial by default)
- payment rails (external settlement systems)

## Primary threats and mitigations

### Sybil node swarm
- provider registration deposit and probation period
- diversity-aware placement (region/ASN spread)
- score and payout ramp-up for new nodes

### Proof replay/forgery
- nonce-bound challenge-response
- freshness windows on proof submissions
- signed responses and verifier audit logs

### Data withholding
- erasure coding and replica fanout
- continuous audit challenges
- automatic repair when redundancy dips below target

### API abuse / DDoS
- edge WAF and per-tenant rate limiting
- token caveats (bucket/prefix/op/expiry)
- adaptive throttling for abusive keys/IPs

### Supply-chain compromise
- image signing and SBOM generation
- pinned build pipelines and branch protections
- dependency update cadence with CVE scanning

### Insider and payout fraud
- dual-control payout approvals for high-value periods
- immutable payout audit trail
- anomaly detection on node usage and proof patterns

## Secure node baseline
- run as non-root
- minimal filesystem and read/write scope
- encrypted chunk-only storage
- signed updates with rollback protection

## Enterprise hardening options
- private control-plane tenancy
- KMS/HSM-backed secret management
- secure enclave verifier workers
