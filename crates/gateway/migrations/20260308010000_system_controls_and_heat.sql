CREATE TABLE IF NOT EXISTS system_controls (
    key TEXT PRIMARY KEY,
    value_json JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO system_controls (key, value_json)
VALUES
    ('writes_locked', 'false'::jsonb),
    ('node_admission_locked', 'false'::jsonb),
    ('payouts_locked', 'false'::jsonb),
    ('quarantine_new_nodes', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS object_heat (
    object_cid TEXT PRIMARY KEY,
    bucket TEXT NOT NULL,
    object_key TEXT NOT NULL,
    access_count BIGINT NOT NULL DEFAULT 0,
    rolling_heat DOUBLE PRECISION NOT NULL DEFAULT 0,
    last_accessed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_object_heat_bucket ON object_heat(bucket, rolling_heat DESC);
CREATE INDEX IF NOT EXISTS idx_object_heat_last_access ON object_heat(last_accessed_at DESC);
