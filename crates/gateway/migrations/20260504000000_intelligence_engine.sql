-- Intelligence Engine: Add trust scoring columns to node_registry
-- These columns are updated by the background IntelligenceEngine daemon

ALTER TABLE node_registry ADD COLUMN IF NOT EXISTS trust_score DOUBLE PRECISION DEFAULT 0.7;
ALTER TABLE node_registry ADD COLUMN IF NOT EXISTS trust_verdict VARCHAR(20) DEFAULT 'trusted';
ALTER TABLE node_registry ADD COLUMN IF NOT EXISTS trust_anomalies TEXT DEFAULT '[]';
ALTER TABLE node_registry ADD COLUMN IF NOT EXISTS trust_evaluated_at TIMESTAMPTZ;

-- Index for the smart placement query (ORDER BY trust_score DESC, free_gb DESC)
CREATE INDEX IF NOT EXISTS idx_node_trust_placement
    ON node_registry (trust_score DESC, free_gb DESC)
    WHERE status = 'online';

-- Allow 'quarantined' as a valid status (the engine auto-sets this)
-- No enum constraint exists, so this is already valid with VARCHAR.

-- Proof challenge table: add created_at if missing for time-windowed queries
ALTER TABLE zk_proof_challenges ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Index for proof pass-rate calculation per node
CREATE INDEX IF NOT EXISTS idx_proof_challenges_peer_status
    ON zk_proof_challenges (peer_id, status, created_at);
