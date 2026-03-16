-- 006: Telegram group scraping & channel invite tables
-- Run against Supabase SQL editor

-- Source groups to scrape members from
CREATE TABLE IF NOT EXISTS tg_source_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link TEXT UNIQUE NOT NULL,
  username TEXT,
  invite_hash TEXT,
  title TEXT,
  member_count INT,
  joined BOOLEAN DEFAULT false,
  scraped_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','joined','scraping','scraped','error')),
  error_msg TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Deduplicated pool of scraped members across all groups
CREATE TABLE IF NOT EXISTS tg_scraped_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT UNIQUE NOT NULL,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  access_hash BIGINT,
  source_group_id UUID REFERENCES tg_source_groups(id) ON DELETE SET NULL,
  is_bot BOOLEAN DEFAULT false,
  invite_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (invite_status IN ('pending','invited','failed','skipped')),
  invite_error TEXT,
  invited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tg_scraped_members_status ON tg_scraped_members(invite_status);
CREATE INDEX IF NOT EXISTS idx_tg_scraped_members_group ON tg_scraped_members(source_group_id);
CREATE INDEX IF NOT EXISTS idx_tg_source_groups_status ON tg_source_groups(status);
