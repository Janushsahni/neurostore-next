# Environment Strategy

## Local sandbox
- Primary stack: `deploy/docker-compose.yml`
- Includes Postgres, Redis, gateway, load balancer, sentinel, and web UI.
- Use for developer iteration and smoke/perf checks.

## Compatibility stack
- `deploy/docker-compose.option-a.yml` is a compatibility compose profile for control-plane + gateway + node flows.
- Use only when validating legacy Option-A control-plane behavior.

## Testnet
- Open provider onboarding with capped payouts and synthetic load schedules.
- SLA remains best-effort.

## Mainnet
- Staged provider onboarding with risk scoring.
- Contractual SLOs for paid tenants.
- Progressive regional expansion with explicit capacity gates.
