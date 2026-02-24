-- ============================================================
-- WA Dealer: Migrate Telegram from bots to user accounts
-- Run this SQL in Supabase Dashboard → SQL Editor
-- ============================================================

-- Drop old bot tables (in correct order due to foreign keys)
DROP TABLE IF EXISTS tg_leads;
DROP TABLE IF EXISTS tg_campaigns;
DROP TABLE IF EXISTS tg_bots;

-- Drop old RPC functions
DROP FUNCTION IF EXISTS increment_tg_campaign_sent(UUID);
DROP FUNCTION IF EXISTS increment_tg_campaign_errors(UUID);

-- ─── Telegram accounts (user profiles, NOT bots) ───────────────────────────

CREATE TABLE IF NOT EXISTS tg_accounts (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone           TEXT UNIQUE NOT NULL,
  session_string  TEXT,                                  -- GramJS StringSession for persistence
  username        TEXT,
  first_name      TEXT,
  last_name       TEXT,
  status          TEXT DEFAULT 'disconnected',           -- disconnected, awaiting_code, awaiting_password, active, error
  error_msg       TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ─── Telegram campaigns (references accounts instead of bots) ──────────────

CREATE TABLE IF NOT EXISTS tg_campaigns (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name            TEXT NOT NULL,
  template_text   TEXT NOT NULL,
  account_id      UUID REFERENCES tg_accounts(id),
  status          TEXT DEFAULT 'draft',                  -- draft, running, paused, stopped, completed
  delay_min_sec   INT DEFAULT 3,
  delay_max_sec   INT DEFAULT 8,
  total_sent      INT DEFAULT 0,
  total_errors    INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ─── Telegram leads (unchanged structure) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS tg_leads (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_id         TEXT NOT NULL,
  username        TEXT,
  first_name      TEXT,
  campaign_id     UUID REFERENCES tg_campaigns(id),
  status          TEXT DEFAULT 'pending',                -- pending, sent, failed, skipped
  sent_at         TIMESTAMPTZ,
  error_message   TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ─── Indexes ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_tg_accounts_status  ON tg_accounts(status);
CREATE INDEX IF NOT EXISTS idx_tg_leads_campaign   ON tg_leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_tg_leads_status     ON tg_leads(status);

-- ─── RPC functions ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION increment_tg_campaign_sent(campaign_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE tg_campaigns SET total_sent = total_sent + 1 WHERE id = campaign_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION increment_tg_campaign_errors(campaign_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE tg_campaigns SET total_errors = total_errors + 1 WHERE id = campaign_id;
END;
$$ LANGUAGE plpgsql;
