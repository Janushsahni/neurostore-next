ALTER TABLE node_registry ADD COLUMN IF NOT EXISTS claim_token TEXT;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS claim_token TEXT;

CREATE TABLE IF NOT EXISTS node_ownership (
    node_id TEXT PRIMARY KEY REFERENCES node_registry(node_id),
    owner_email TEXT NOT NULL REFERENCES users(email),
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_node_ownership_email ON node_ownership(owner_email);
