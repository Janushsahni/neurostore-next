# Environment Strategy

## Local sandbox
- Compose stack from `deploy/docker-compose.option-a.yml`
- 2 local provider nodes + control plane + observability
- used for developer iteration and protocol smoke tests

## Testnet
- open onboarding for providers with capped payouts
- synthetic workload generators and chaos schedule
- SLA is best-effort, not contractual

## Mainnet
- staged provider onboarding with risk scoring
- contractual SLOs for paid tenants
- progressive regional expansion and capacity controls
