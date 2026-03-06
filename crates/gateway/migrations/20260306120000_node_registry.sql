-- Node Registry: tracks all connected storage nodes, their status, and earnings
CREATE TABLE IF NOT EXISTS node_registry (
    node_id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'online',      -- online, offline, degraded
    ip_address TEXT,
    os TEXT,
    os_version TEXT,
    version TEXT NOT NULL DEFAULT '1.0.0',
    shard_count INTEGER NOT NULL DEFAULT 0,
    used_gb REAL NOT NULL DEFAULT 0.0,
    max_gb REAL NOT NULL DEFAULT 50.0,
    free_gb REAL NOT NULL DEFAULT 0.0,
    uptime_minutes REAL NOT NULL DEFAULT 0.0,
    total_earned_inr REAL NOT NULL DEFAULT 0.0,  -- cumulative earnings in ₹
    last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    country_code TEXT DEFAULT 'IN'
);

-- Earnings ledger: tracks individual earnings events
CREATE TABLE IF NOT EXISTS node_earnings (
    id SERIAL PRIMARY KEY,
    node_id TEXT NOT NULL REFERENCES node_registry(node_id),
    amount_inr REAL NOT NULL,
    reason TEXT NOT NULL,               -- 'uptime_reward', 'shard_stored', 'bandwidth_bonus'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_node_earnings_node_id ON node_earnings (node_id);
CREATE INDEX IF NOT EXISTS idx_node_registry_status ON node_registry (status);
CREATE INDEX IF NOT EXISTS idx_node_registry_heartbeat ON node_registry (last_heartbeat_at);
