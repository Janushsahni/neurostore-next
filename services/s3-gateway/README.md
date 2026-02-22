# S3 Gateway

`services/s3-gateway` provides path-style S3-compatible endpoints and integrates with control-plane auth/usage.

## Features
- Path-style object operations:
  - `PUT /s3/{bucket}/{key}`
  - `GET /s3/{bucket}/{key}`
  - `HEAD /s3/{bucket}/{key}`
  - `DELETE /s3/{bucket}/{key}`
- Bucket listing:
  - `GET /s3/{bucket}?list-type=2&prefix=&max-keys=&continuation-token=`
- Multipart upload:
  - `POST /s3/{bucket}/{key}?uploads`
  - `PUT /s3/{bucket}/{key}?uploadId=&partNumber=`
  - `POST /s3/{bucket}/{key}?uploadId=`
  - `GET /s3/{bucket}/{key}?uploadId=`
  - `DELETE /s3/{bucket}/{key}?uploadId=`
- Presigned URL generation:
  - `POST /v1/presign`
- Macaroon token verification via control-plane.
- AWS Signature V4 verification:
  - `Authorization: AWS4-HMAC-SHA256 ...`
  - Presigned query auth (`X-Amz-*` parameters)
- Dynamic key resolution from control-plane (`/v1/sigv4/resolve`) with local cache
- Best-effort usage ingestion via control-plane.
- `GET /readyz` exposes `production_ready` and `readiness_warnings` to gate deployments.

## Run

```bash
cd services/s3-gateway
node server.mjs
```

Environment variables:
- `PORT` default `9009`
- `CONTROL_PLANE_URL` default `http://127.0.0.1:8080`
- `REQUIRE_AUTH` default `true`
- `PRESIGN_SECRET` default `dev-presign-secret`
- `MAX_BODY_BYTES` default `268435456`
- `S3_DATA_DIR` default `.tmp/s3-gateway/data`
- `S3_META_FILE` default `.tmp/s3-gateway/metadata.json`
- `S3_MULTIPART_DIR` default `.tmp/s3-gateway/multipart`
- `MAX_MULTIPART_PARTS` default `10000`
- `SIGV4_MAX_SKEW_SECONDS` default `900`
- `SIGV4_PROVIDER` one of `env`, `control-plane`, `hybrid` (default `hybrid`)
- `SIGV4_CACHE_TTL_MS` default `60000`
- `SIGV4_CREDENTIALS_JSON` JSON array/map of access keys and secrets
- `SIGV4_CREDENTIALS_FILE` path to credentials JSON file
- `INTERNAL_API_TOKEN` optional token for calling control-plane `/v1/sigv4/resolve`

SigV4 credentials JSON format:

```json
[
  {
    "access_key": "demo-access-key",
    "secret_key": "demo-secret-key",
    "project_id": "prj_demo",
    "bucket": "acme-bucket",
    "prefix": "datasets/",
    "ops": ["put", "get", "head", "list", "delete"],
    "region": "us-east-1",
    "service": "s3"
  }
]
```

## Test

```bash
cd services/s3-gateway
node --test test/*.test.mjs
```
