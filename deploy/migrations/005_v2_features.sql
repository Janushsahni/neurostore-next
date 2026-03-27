-- Migration 005_v2_features.sql
-- Supports production hardening V2 features: object shards tracking, node earnings, and usage billing

-- 1. Object Shards Tracking (for repair daemon proactive migration + thundering herd)
CREATE TABLE IF NOT EXISTS object_shards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_cid TEXT NOT NULL REFERENCES objects(cid) ON DELETE CASCADE,
    chunk_cid TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    peer_id TEXT NOT NULL REFERENCES nodes(peer_id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(object_cid, chunk_index, peer_id)
);

CREATE INDEX IF NOT EXISTS idx_object_shards_peer ON object_shards(peer_id);
CREATE INDEX IF NOT EXISTS idx_object_shards_chunk ON object_shards(chunk_cid);

-- 2. Macaroon API Keys (for API key rotation)
CREATE TABLE IF NOT EXISTS cp_macaroons (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES cp_projects(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Audit Log (for tracking password changes, deregistration, key rotation)
CREATE TABLE IF NOT EXISTS cp_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action TEXT NOT NULL,
    actor TEXT NOT NULL,
    target TEXT NOT NULL,
    details JSONB DEFAULT '{}'::jsonb,
    ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON cp_audit_log(actor);

-- 4. Session Tracking
CREATE TABLE IF NOT EXISTS cp_sessions (
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL REFERENCES cp_users(username) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON cp_sessions(expires_at);
