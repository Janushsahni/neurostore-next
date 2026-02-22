# Option A Runbook

## 1. Start local stack

```bash
docker compose -f deploy/docker-compose.option-a.yml up --build
docker compose --env-file deploy/.env.option-a.prod -f deploy/docker-compose.option-a.yml up --build -d
docker compose --env-file deploy/.env.option-a.prod -f deploy/docker-compose.option-a.yml -f deploy/docker-compose.edge.yml up --build -d
```

## 2. Create project

```bash
curl -sS -X POST http://127.0.0.1:8080/v1/projects \
  -H 'content-type: application/json' \
  -d '{"name":"acme-archive","billing_email":"ops@acme.test","tier":"archive"}'
```

Capture `project_id` from response.

## 3. Issue macaroon token

```bash
curl -sS -X POST http://127.0.0.1:8080/v1/tokens/macaroon \
  -H 'content-type: application/json' \
  -d '{
    "project_id":"<PROJECT_ID>",
    "bucket":"acme-bucket",
    "prefix":"datasets/",
    "ops":["put","get","head","list","delete"],
    "ttl_seconds":86400
  }'
```

Capture `token` from response.

## 4. Upload object through S3 gateway

```bash
echo 'hello-neurostore' > /tmp/object.txt
curl -sS -X PUT "http://127.0.0.1:9009/s3/acme-bucket/datasets/object.txt" \
  -H "authorization: Bearer <TOKEN>" \
  -H 'content-type: text/plain' \
  --data-binary @/tmp/object.txt -i
```

## 5. Read object metadata + content

```bash
curl -sSI "http://127.0.0.1:9009/s3/acme-bucket/datasets/object.txt" \
  -H "authorization: Bearer <TOKEN>"

curl -sS "http://127.0.0.1:9009/s3/acme-bucket/datasets/object.txt" \
  -H "authorization: Bearer <TOKEN>"
```

## 6. List bucket prefix

```bash
curl -sS "http://127.0.0.1:9009/s3/acme-bucket?list-type=2&prefix=datasets/" \
  -H "authorization: Bearer <TOKEN>"
```

## 7. Check usage and payout previews

```bash
curl -sS "http://127.0.0.1:8080/v1/usage/<PROJECT_ID>?period=$(date +%Y-%m)"

curl -sS "http://127.0.0.1:8080/v1/payouts/preview?period=$(date +%Y-%m)"
```

## 8. Health and metrics

```bash
curl -sS http://127.0.0.1:8080/readyz
curl -sS http://127.0.0.1:8080/metrics
curl -sS http://127.0.0.1:9009/readyz
curl -sS http://127.0.0.1:9009/metrics
```

Both `readyz` payloads now include:
- `production_ready` (`true|false`)
- `readiness_warnings` (array)

Use `scripts/deploy-readiness.sh --strict` to fail fast if production warnings exist.
Use `scripts/k8s-readiness.sh --strict` to validate Kubernetes production manifests.

## 9. SigV4 request path (AWS SDK/CLI style)

Local compose defaults include a demo SigV4 credential:
- `AWS_ACCESS_KEY_ID=demo-access-key`
- `AWS_SECRET_ACCESS_KEY=demo-secret-key`
- region: `us-east-1`

Example with AWS CLI path-style S3:

```bash
AWS_ACCESS_KEY_ID=demo-access-key \
AWS_SECRET_ACCESS_KEY=demo-secret-key \
AWS_DEFAULT_REGION=us-east-1 \
aws s3api put-object \
  --endpoint-url http://127.0.0.1:9009/s3 \
  --bucket acme-bucket \
  --key datasets/sigv4-object.txt \
  --body /tmp/object.txt
```

## 10. Dynamic SigV4 key lifecycle (control-plane managed)

Issue SigV4 key tied to project policy:

```bash
curl -sS -X POST http://127.0.0.1:8080/v1/sigv4/keys \
  -H 'content-type: application/json' \
  -d '{
    "project_id":"<PROJECT_ID>",
    "label":"ci-agent",
    "bucket":"acme-bucket",
    "prefix":"datasets/",
    "ops":["put","get","head","list","delete"],
    "region":"us-east-1",
    "service":"s3",
    "ttl_seconds":86400
  }'
```

List current keys:

```bash
curl -sS "http://127.0.0.1:8080/v1/sigv4/keys?project_id=<PROJECT_ID>"
```

Revoke key:

```bash
curl -sS -X POST http://127.0.0.1:8080/v1/sigv4/keys/revoke \
  -H 'content-type: application/json' \
  -d '{"access_key":"<ACCESS_KEY>"}'
```
