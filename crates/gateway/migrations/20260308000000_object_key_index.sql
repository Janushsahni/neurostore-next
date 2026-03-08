ALTER TABLE objects
    ADD COLUMN IF NOT EXISTS encrypted_key TEXT;

UPDATE objects
SET encrypted_key = key
WHERE encrypted_key IS NULL;
