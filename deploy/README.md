# Deployment

## Local production-like stack

```bash
docker compose -f deploy/docker-compose.option-a.yml up --build
docker compose --env-file deploy/.env.option-a.prod -f deploy/docker-compose.option-a.yml up --build -d
docker compose --env-file deploy/.env.option-a.prod -f deploy/docker-compose.option-a.yml -f deploy/docker-compose.edge.yml up --build -d
scripts/deploy-readiness.sh
scripts/deploy-readiness.sh --strict
scripts/k8s-readiness.sh --strict
```

Services:
- control-plane API: `http://127.0.0.1:8080`
- s3-gateway API: `http://127.0.0.1:9009`
- Prometheus: `http://127.0.0.1:9090`
- Grafana: `http://127.0.0.1:3000`
- NATS: `127.0.0.1:4222`
- Redpanda/Kafka: `127.0.0.1:9092`
- PostgreSQL: `127.0.0.1:5432`
- Redis: `127.0.0.1:6379`

Notes:
- control-plane runs with `STATE_BACKEND=postgres` and caches state in Redis.
- s3-gateway verifies macaroons via control-plane and ingests usage counters.
- s3-gateway also verifies AWS SigV4 requests; replace demo credentials before production use.
- control-plane exposes dynamic SigV4 key APIs; gateway resolves keys through `/v1/sigv4/resolve` using `INTERNAL_API_TOKEN`.
- `--strict` readiness mode fails when `production_ready=false` (weak/default secrets, missing internal tokens, etc.).
- Use `deploy/.env.option-a.prod.example` as baseline for production secret/config values.
- `deploy/docker-compose.edge.yml` adds an internet-facing TLS reverse proxy (Nginx).
- Place TLS files at:
  - `deploy/certs/fullchain.pem`
  - `deploy/certs/privkey.pem`
- Edge proxy hostnames come from env file:
  - `CONTROL_PLANE_HOST`
  - `S3_HOST`

## Kubernetes

```bash
scripts/generate-k8s-secrets.sh deploy/.env.option-a.prod
kubectl apply -k deploy/k8s/generated
```

Manifests include:
- namespace
- control-plane config/secret
- deployment + service
- horizontal pod autoscaler
- network policy
- ingress + TLS

Generated overlay:
- `deploy/k8s/generated/control-plane-secret.yaml`
- `deploy/k8s/generated/s3-gateway-secret.yaml`
- `deploy/k8s/generated/ingress-patch.yaml`
- `deploy/k8s/generated/kustomization.yaml`

Security note:
- `deploy/.env.option-a.prod`, `deploy/certs/*.pem`, and `deploy/k8s/generated/` are ignored by git because they contain secrets.

## Container images

- Control plane: `services/control-plane/Dockerfile`
- S3 gateway: `services/s3-gateway/Dockerfile`
- Node daemon: `deploy/docker/node.Dockerfile`
