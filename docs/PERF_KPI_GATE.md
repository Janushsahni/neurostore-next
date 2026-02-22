# Performance KPI Gate

This benchmark harness measures local Option A control-plane + S3 gateway behavior and optionally enforces KPI gates.

## Run

Start stack first:

```bash
docker compose --env-file deploy/.env.option-a.prod -f deploy/docker-compose.option-a.yml up --build -d
```

Run benchmark report:

```bash
scripts/perf-kpi-gate.sh
```

Run strict KPI gate (non-zero exit on target miss):

```bash
scripts/perf-kpi-gate.sh --strict
```

## What it measures

- `PUT` latency and success ratio through S3 gateway.
- `GET` latency and success ratio through S3 gateway (with payload integrity check).
- `POST /v1/placement/suggest` latency and success ratio.
- `GET /v1/ai/placement/strategy` latency and success ratio.
- `GET /v1/ai/nodes/risk` latency and success ratio.

## KPI targets in strict mode

- `put_p95_ms <= 700`
- `get_p95_ms <= 400`
- `get_p99_ms <= 900`
- `placement_p95_ms <= 250`
- `ai_strategy_p95_ms <= 200`
- `ai_risk_p95_ms <= 180`
- all operation success rates = `100%` for sampled runs

## Notes

- Competitor values in the report are reference comparators only.
- This harness validates local segment performance and release gates; it does not prove global network superiority by itself.
