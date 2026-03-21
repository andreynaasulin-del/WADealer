-- Table for scraped working girls profiles
CREATE TABLE IF NOT EXISTS tg_girls (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id BIGINT NOT NULL UNIQUE,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  access_hash TEXT,
  bio TEXT,
  score INTEGER DEFAULT 0,
  signals TEXT[], -- array of detection signals
  source_group TEXT, -- which group they were scraped from
  dm_status TEXT DEFAULT 'pending' CHECK (dm_status IN ('pending', 'sent', 'replied', 'blocked', 'failed', 'skipped')),
  dm_sent_at TIMESTAMPTZ,
  dm_sent_by TEXT, -- which TG account sent the DM
  dm_error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tg_girls_dm_status ON tg_girls(dm_status);
CREATE INDEX IF NOT EXISTS idx_tg_girls_user_id ON tg_girls(user_id);
CREATE INDEX IF NOT EXISTS idx_tg_girls_score ON tg_girls(score DESC);
