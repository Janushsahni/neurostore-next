-- Create users table
CREATE TABLE IF NOT EXISTS users (
    email TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    name TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create buckets table (for future access control and billing)
CREATE TABLE IF NOT EXISTS buckets (
    name TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create objects table (files)
CREATE TABLE IF NOT EXISTS objects (
    bucket TEXT NOT NULL REFERENCES buckets(name) ON DELETE CASCADE,
    key TEXT NOT NULL,
    etag TEXT NOT NULL,
    cid TEXT NOT NULL,
    shards INTEGER NOT NULL,
    recovery_threshold INTEGER NOT NULL,
    size BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata_json JSONB,
    PRIMARY KEY (bucket, key)
);

-- Indexes for fast querying
CREATE INDEX idx_objects_bucket ON objects(bucket);
CREATE INDEX idx_objects_cid ON objects(cid);
