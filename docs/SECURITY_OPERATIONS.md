# Security Operations Baseline

## 1. WAF and Edge Controls
- Place Cloudflare/AWS WAF in front of gateway and control-plane.
- Block common exploit signatures (SQLi, XSS, path traversal, SSRF).
- Enforce geo policy at edge for management endpoints.

## 2. Rate Limits
- Gateway: `GATEWAY_RATE_LIMIT_RPS` (default `200`).
- Control-plane: `CP_RATE_LIMIT_RPS` (default `120`).
- Login lockout: `CP_AUTH_LOCK_THRESHOLD` + `CP_AUTH_LOCK_SECS`.

## 3. Session Security
- Browser auth uses `HttpOnly` cookie session and CSRF token (`x-csrf-token`).
- Set `COOKIE_SECURE=true` in production TLS deployments.

## 4. Key Rotation
- Rotate every 90 days (or immediately after incident):
  - `JWT_SECRET`
  - `METADATA_SECRET`
  - `PROOF_SUBMIT_TOKEN`
  - `COMPLIANCE_SIGNING_KEY`
  - `MACAROON_SECRET`
  - `NODE_SHARED_SECRET`
- Rotation runbook:
  1. Generate new secret in KMS/HSM.
  2. Deploy as secondary key and support overlap window.
  3. Re-issue sessions/tokens.
  4. Disable old key and verify no stale use.
  5. Log rotation event in audit logs.

## 5. SIEM Integration
- Stream structured logs to SIEM (Datadog/Splunk/ELK):
  - Auth failures and lockouts
  - Node registration/heartbeat anomalies
  - Proof verification failures
  - Compliance report generation
- Alert on:
  - spike in failed logins
  - repeated proof failures per node
  - sudden country-code drift for shard evidence

## 6. Incident Runbook
- Severity levels:
  - `SEV-1`: data integrity/compliance risk
  - `SEV-2`: auth bypass/service degradation
  - `SEV-3`: isolated node or client issue
- Mandatory steps:
  1. Contain affected endpoints.
  2. Preserve logs and DB snapshots.
  3. Rotate impacted keys/tokens.
  4. Run integrity/proof audit sweep.
  5. Publish postmortem with remediation SLA.
