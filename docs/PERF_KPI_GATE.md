# Performance KPI Gate

This benchmark script validates authenticated object PUT/GET performance through the deployed gateway.

## Prerequisites

Start the stack first:

```bash
docker compose -f deploy/docker-compose.yml up --build -d
```

## Run

Benchmark report only:

```bash
scripts/perf-kpi-gate.sh
```

Strict gate (non-zero exit when thresholds are missed):

```bash
scripts/perf-kpi-gate.sh --strict
```

## Script behavior

- Registers a temporary user via `POST /auth/register`.
- Uses session cookies + CSRF token to run authenticated S3-style requests.
- Runs `PUT` and `GET` loops on `/:bucket/:key`.
- Verifies payload integrity for each sample.
- Deletes each object to avoid benchmark data growth.

## Default strict thresholds

- `success_rate >= 1.0`
- `put_p95_ms <= 700`
- `get_p95_ms <= 400`
- `get_p99_ms <= 900`

You can override thresholds with:

- `--max-put-p95-ms`
- `--max-get-p95-ms`
- `--max-get-p99-ms`
- `--min-success-rate`
