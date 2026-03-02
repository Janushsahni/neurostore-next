-- NeuroStore Phase 3 Migration: Feature Tables
-- Adds PII scan logs, object versioning, WORM mode support

-- PII Scan Audit Logs
CREATE TABLE IF NOT EXISTS pii_scan_logs (
    id SERIAL PRIMARY KEY,
    bucket VARCHAR(255) NOT NULL,
    key TEXT NOT NULL,
    has_pii BOOLEAN NOT NULL DEFAULT FALSE,
    risk_level VARCHAR(20) NOT NULL DEFAULT 'NONE',
    findings_count INTEGER NOT NULL DEFAULT 0,
    scanned_by VARCHAR(255) NOT NULL,
    scanned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pii_scans_bucket ON pii_scan_logs(bucket);
CREATE INDEX IF NOT EXISTS idx_pii_scans_risk ON pii_scan_logs(risk_level);

-- Object Versioning (stores version snapshots on each PUT)
CREATE TABLE IF NOT EXISTS object_versions (
    id SERIAL PRIMARY KEY,
    bucket VARCHAR(255) NOT NULL,
    key TEXT NOT NULL,
    version_id VARCHAR(64) NOT NULL UNIQUE,
    size BIGINT NOT NULL DEFAULT 0,
    etag VARCHAR(255) NOT NULL,
    metadata_json TEXT,
    cid VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_versions_bucket_key ON object_versions(bucket, key);

-- WORM (Write Once Read Many) mode columns on buckets
ALTER TABLE buckets ADD COLUMN IF NOT EXISTS worm_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE buckets ADD COLUMN IF NOT EXISTS worm_retention_days INTEGER DEFAULT 0;

-- AI Auto-Tag results cache
CREATE TABLE IF NOT EXISTS auto_tags (
    id SERIAL PRIMARY KEY,
    bucket VARCHAR(255) NOT NULL,
    key TEXT NOT NULL,
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    category VARCHAR(64),
    confidence DOUBLE PRECISION DEFAULT 0.0,
    tagged_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(bucket, key)
);
