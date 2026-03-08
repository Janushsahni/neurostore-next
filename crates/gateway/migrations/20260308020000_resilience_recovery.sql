CREATE TABLE IF NOT EXISTS node_attestations (
    peer_id TEXT PRIMARY KEY REFERENCES nodes(peer_id) ON DELETE CASCADE,
    admission_status TEXT NOT NULL DEFAULT 'pending',
    risk_score INTEGER NOT NULL DEFAULT 0,
    risk_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
    residential_score REAL NOT NULL DEFAULT 0.0,
    payout_hold_until TIMESTAMPTZ,
    estimated_monthly_payout_inr REAL NOT NULL DEFAULT 0.0,
    estimated_monthly_cost_inr REAL NOT NULL DEFAULT 0.0,
    build_digest TEXT,
    last_reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS repair_jobs (
    id BIGSERIAL PRIMARY KEY,
    object_cid TEXT NOT NULL,
    bucket TEXT NOT NULL,
    object_key TEXT NOT NULL,
    healthy_shards INTEGER NOT NULL,
    target_shards INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    severity TEXT NOT NULL DEFAULT 'warning',
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (object_cid, status)
);

CREATE INDEX IF NOT EXISTS idx_repair_jobs_status ON repair_jobs(status, created_at DESC);

CREATE TABLE IF NOT EXISTS recovery_kits (
    email TEXT PRIMARY KEY REFERENCES users(email) ON DELETE CASCADE,
    kit_id TEXT NOT NULL,
    wrapped_vault_key TEXT NOT NULL,
    wrapped_manifest_seed TEXT,
    recovery_contacts JSONB NOT NULL DEFAULT '[]'::jsonb,
    recovery_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE nodes ADD COLUMN IF NOT EXISTS attestation_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS payout_hold_until TIMESTAMPTZ;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS device_fingerprint TEXT;
