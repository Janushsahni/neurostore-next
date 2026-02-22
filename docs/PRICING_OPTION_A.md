# Pricing Model (Option A)

## Customer pricing
- Archive: `$7 / TB-month` + `$8 / TB egress`
- Active: `$11 / TB-month` + lower egress tariff
- API requests: billed per million operations

## Node payouts
- Base payout from `stored_gb_hours` and `egress_gb`.
- Quality multiplier from reliability score.
- Penalties for proof failures and sustained degradation.

## Monthly economics example
- Assumption: `n/k = 22/16 = 1.375x`
- Provider storage cost equivalent: `$2.4/TB-month`
- Control-plane and repair reserve: `$2.1/TB-month`
- Settlement overhead: `$0.3/TB-month`
- Total COGS: `~$5.4/TB-month`

## Revenue milestones (base case)
- Month 6: `~1 PB`, `~$9k MRR`
- Month 9: `~5 PB`, `~$52k MRR`
- Month 12: `~15 PB`, `~$180k MRR`
