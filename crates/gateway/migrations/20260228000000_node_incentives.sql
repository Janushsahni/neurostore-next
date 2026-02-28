-- Add wallet_address and storage_capacity_gb to nodes table for NeuroStore Incentives
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS wallet_address TEXT;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS storage_capacity_gb BIGINT DEFAULT 0;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
