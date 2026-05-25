-- Add new profile columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS birthday TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_method TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS receives_announcements BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS receives_apps_music BOOLEAN DEFAULT true;

-- Create otps table for email/phone verification
CREATE TABLE IF NOT EXISTS otps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identifier TEXT NOT NULL, -- email or phone number
    otp_code TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_otps_identifier ON otps(identifier);
