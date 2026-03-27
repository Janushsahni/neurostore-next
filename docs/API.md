# NeuroStore API Documentation

The NeuroStore platform uses a hybrid architecture with a high-performance Rust Gateway for data transfer and a Node.js Control Plane for user management, billing, and coordination.

## Base URLs
- **Object Storage / S3 API**: `https://{bucket}.api.neurostore.io`
- **Control Plane API**: `https://api.neurostore.io/v1`

## Authentication
NeuroStore uses **Macaroons** for stateless, delegatable API authentication.

**Header Format:**
```http
Authorization: Bearer <macaroon_token>
```

---

## 1. Object Storage API (Gateway)

### Upload Object
Direct, end-to-end encrypted upload mapping to multiple nodes.

```http
PUT /{bucket}/{key}
Host: your-bucket.api.neurostore.io
Authorization: Bearer <token>
Content-Type: application/octet-stream

<raw bytes>
```

### Download Object
```http
GET /{bucket}/{key}
Host: your-bucket.api.neurostore.io
Authorization: Bearer <token>
```

### Delete Object
```http
DELETE /{bucket}/{key}
Host: your-bucket.api.neurostore.io
Authorization: Bearer <token>
```

---

## 2. Control Plane API (User / Tenant)

### Rotate API Token
Invalidates all existing tokens for the project and issues a new one.

```http
POST /v1/tokens/rotate
Content-Type: application/json
Authorization: Bearer <session_cookie>

{
  "project_id": "uuid-string"
}
```

### Change Password
Re-verifies current password and invalidates all active sessions.

```http
POST /v1/auth/change-password
Content-Type: application/json

{
  "current_password": "...",
  "new_password": "..."
}
```

---

## 3. Node Operator API

### Node Registration
Register a new physical node to join the Swarm.

```http
POST /v1/nodes/register
Content-Type: application/json
x-node-secret: <NODE_SHARED_SECRET>

{
  "peer_id": "12D3Koo...",
  "wallet_address": "0x...",
  "capacity_gb": 1000,
  "declared_location": "US-EAST1"
}
```

### Node Heartbeat
Nodes must heartbeat every 60 seconds with their `PeerId`.

```http
POST /v1/nodes/heartbeat
Content-Type: application/json
x-node-secret: <NODE_SHARED_SECRET>

{
  "peer_id": "12D3Koo...",
  "used_bytes": 10737418240,
  "capacity_bytes": 1099511627776
}
```

### Node Deregistration (Graceful Exit)
Triggers graceful shard migration via the Repair Daemon before shutting down to prevent slashing.

```http
POST /v1/nodes/deregister
Content-Type: application/json
x-node-secret: <NODE_SHARED_SECRET>

{
  "peer_id": "12D3Koo...",
  "reason": "hardware_upgrade"
}
```
