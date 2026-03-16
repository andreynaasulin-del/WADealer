-- Add gender column to tg_scraped_members for male-only filtering
ALTER TABLE tg_scraped_members
  ADD COLUMN IF NOT EXISTS gender TEXT NOT NULL DEFAULT 'unknown'
  CHECK (gender IN ('male', 'female', 'unknown'));
