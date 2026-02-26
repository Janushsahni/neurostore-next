-- Create nodes table for V8 Super Node Tiering
CREATE TABLE IF NOT EXISTS nodes (
    peer_id TEXT PRIMARY KEY,
    ip_address TEXT,
    country_code TEXT DEFAULT 'XX',
    bandwidth_capacity_mbps BIGINT DEFAULT 10,
    uptime_percentage REAL DEFAULT 0.0,
    is_super_node BOOLEAN DEFAULT FALSE,
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for jurisdiction queries (GDPR geofencing)
CREATE INDEX idx_nodes_country ON nodes(country_code);

-- Index for Super Node selection
CREATE INDEX idx_nodes_performance ON nodes(is_super_node) WHERE is_super_node = TRUE;
