-- Cloud-mode fallback: store shard data directly in Postgres when no P2P nodes are available
CREATE TABLE IF NOT EXISTS shard_data (
    shard_cid TEXT PRIMARY KEY,
    object_cid TEXT NOT NULL,
    shard_index INTEGER NOT NULL,
    data BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shard_data_object_cid ON shard_data (object_cid);
