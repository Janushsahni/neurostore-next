ALTER TABLE node_registry ADD COLUMN IF NOT EXISTS cpu_usage_percent REAL DEFAULT 0.0;
ALTER TABLE node_registry ADD COLUMN IF NOT EXISTS memory_usage_percent REAL DEFAULT 0.0;
ALTER TABLE node_registry ADD COLUMN IF NOT EXISTS hostname TEXT;
ALTER TABLE node_registry ADD COLUMN IF NOT EXISTS device_fingerprint TEXT;
ALTER TABLE node_registry ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE node_registry ADD COLUMN IF NOT EXISTS mac_address VARCHAR(255);
