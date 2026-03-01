CREATE TABLE IF NOT EXISTS object_shards (
    object_cid TEXT NOT NULL,
    shard_cid TEXT NOT NULL,
    shard_index INTEGER NOT NULL,
    peer_id TEXT NOT NULL,
    country_code TEXT NOT NULL DEFAULT 'XX',
    receipt_timestamp_ms BIGINT NOT NULL DEFAULT 0,
    receipt_signature_valid BOOLEAN NOT NULL DEFAULT FALSE,
    last_verified_at TIMESTAMPTZ,
    last_challenge_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (object_cid, shard_index)
);

CREATE INDEX IF NOT EXISTS idx_object_shards_peer ON object_shards(peer_id);
CREATE INDEX IF NOT EXISTS idx_object_shards_country ON object_shards(country_code);

CREATE TABLE IF NOT EXISTS zk_proof_challenges (
    challenge_id TEXT PRIMARY KEY,
    object_cid TEXT NOT NULL,
    shard_cid TEXT NOT NULL,
    shard_index INTEGER NOT NULL,
    peer_id TEXT NOT NULL,
    country_code TEXT NOT NULL DEFAULT 'XX',
    challenge_hex TEXT NOT NULL,
    nonce_hex TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    response_hash TEXT,
    signature_hex TEXT,
    public_key_hex TEXT,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    verified_at TIMESTAMPTZ,
    failure_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_zk_proof_challenges_status ON zk_proof_challenges(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_zk_proof_challenges_peer ON zk_proof_challenges(peer_id, issued_at DESC);

CREATE TABLE IF NOT EXISTS shard_residency_evidence (
    id BIGSERIAL PRIMARY KEY,
    challenge_id TEXT NOT NULL REFERENCES zk_proof_challenges(challenge_id) ON DELETE CASCADE,
    object_cid TEXT NOT NULL,
    shard_cid TEXT NOT NULL,
    shard_index INTEGER NOT NULL,
    peer_id TEXT NOT NULL,
    country_code TEXT NOT NULL,
    response_hash TEXT NOT NULL,
    signature_hex TEXT NOT NULL,
    public_key_hex TEXT NOT NULL,
    proof_timestamp_ms BIGINT NOT NULL,
    verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shard_residency_object ON shard_residency_evidence(object_cid, verified_at DESC);
CREATE INDEX IF NOT EXISTS idx_shard_residency_country ON shard_residency_evidence(country_code, verified_at DESC);
