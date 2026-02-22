# Architecture

## Full Protocol Loop

1. `upload`: client chunks + encrypts + erasure-codes + hashes.
2. client ranks peers per shard CID and places replicas deterministically.
3. client sends `STORE` commands to selected peers over Noise-secured libp2p.
4. node persists encrypted shard in `sled` under quota checks and returns signed receipt.
5. client writes metadata-only manifest (salt, shard metadata, placement set, audit vectors, merkle root, manifest hash, password-bound auth tag).
6. `retrieve`: client validates manifest hash/root and requests shards.
7. node returns shard bytes + signed retrieval proof.
8. client verifies proofs/CIDs, retries fallback peers as needed, reconstructs missing shards, decrypts, and restores bytes.
9. `audit`: client sends challenge probes; node returns signed challenge response hash proving shard possession.
10. client enforces response freshness and node rejects replayed audit nonces.

## Core Components

- `node`: transport, routing, durable encrypted shard storage, audit responder, and persistent identity key
- `client-sdk`: cryptographic pipeline + erasure reconstruction
- `protocol`: shared command/reply wire format + signature verification
- `uploader`: operational CLI for replication, retrieval retries, audits, validation, and manifest migration
- `sentinel`: adaptive reputation and anomaly policy engine
- `web`: WASM demo + node map, shard flow, placement/retry traces
- `apps/tauri-shell`: native shell layer for desktop and mobile distribution

## Security Model

- Node stores ciphertext only.
- Key derivation and encryption happen on the client.
- Replies are signed to prevent blind trust in remote peers.
- CID, manifest-hash, and proof verification are required before reconstruction.
- Audit vectors are generated client-side at upload and validated during audits.
- Manifest auth tag binds manifest integrity to user password.
- Node identity key is persisted to preserve peer identity through restarts.
- Node supports bootstrap dial addresses and optional peer allowlist gate.

## Operations

- Uploader can write structured JSON reports for CI and observability hooks.
- Legacy manifests can be migrated into the current authenticated format.

## Option A Production Services

- `services/control-plane` provides tenant/project lifecycle, macaroon issuance, node registry, placement recommendations, billing usage ingestion, and payout previews.
- `services/s3-gateway` provides path-style S3 object APIs with multipart upload and presigned URLs.
- S3 gateway calls control-plane for macaroon verification and metering events.
- Control-plane persistence supports:
  - local file backend (`STATE_BACKEND=file`)
  - PostgreSQL-backed durable state with Redis cache (`STATE_BACKEND=postgres`)

## Resource Limits

- Manifest byte size is capped at `16 MB`.
- Manifest shard count is capped at `250,000`.
- Peers per shard are capped at `64`.
- Audit rounds per shard are capped at `64`.
