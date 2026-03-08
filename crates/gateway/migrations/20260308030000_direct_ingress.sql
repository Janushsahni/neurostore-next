ALTER TABLE nodes ADD COLUMN IF NOT EXISTS ingress_url TEXT;
ALTER TABLE node_registry ADD COLUMN IF NOT EXISTS ingress_url TEXT;

CREATE TABLE IF NOT EXISTS direct_object_chunks (
    object_cid TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    chunk_cid TEXT NOT NULL,
    peer_id TEXT NOT NULL,
    ingress_url TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (object_cid, chunk_index, peer_id)
);

CREATE INDEX IF NOT EXISTS idx_direct_object_chunks_object ON direct_object_chunks(object_cid, chunk_index);
CREATE INDEX IF NOT EXISTS idx_direct_object_chunks_peer ON direct_object_chunks(peer_id);
