-- Webhook notification system migration
-- Run this against your PostgreSQL database to enable webhook functionality

CREATE TABLE IF NOT EXISTS webhooks (
    id SERIAL PRIMARY KEY,
    bucket VARCHAR(255) NOT NULL,
    url VARCHAR(2048) NOT NULL,
    events JSONB NOT NULL DEFAULT '[]'::jsonb,
    secret VARCHAR(255) NOT NULL,
    owner_email VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(bucket, url)
);

CREATE INDEX IF NOT EXISTS idx_webhooks_bucket ON webhooks(bucket);
CREATE INDEX IF NOT EXISTS idx_webhooks_owner ON webhooks(owner_email);

-- Add repair_status to objects metadata (no schema change needed, uses existing JSONB column)
