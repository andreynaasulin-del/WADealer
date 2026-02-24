-- ============================================================
-- WA Dealer: Telegram tables for bot management & campaigns
-- Run this SQL in Supabase Dashboard → SQL Editor
-- ============================================================

-- Telegram bots (аналог wa_sessions)
CREATE TABLE IF NOT EXISTS tg_bots (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bot_token   TEXT UNIQUE NOT NULL,
  bot_username TEXT,
  bot_name    TEXT,
  status      TEXT DEFAULT 'stopped',   -- active, stopped, error
  error_msg   TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Telegram campaigns (аналог wa_campaigns)
CREATE TABLE IF NOT EXISTS tg_campaigns (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name            TEXT NOT NULL,
  template_text   TEXT NOT NULL,
  bot_id          UUID REFERENCES tg_bots(id),
  status          TEXT DEFAULT 'draft',  -- draft, running, paused, stopped, completed
  delay_min_sec   INT DEFAULT 3,
  delay_max_sec   INT DEFAULT 8,
  total_sent      INT DEFAULT 0,
  total_errors    INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Telegram leads (аналог leads_for_invite, но chat_id вместо phone)
CREATE TABLE IF NOT EXISTS tg_leads (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_id      TEXT NOT NULL,
  username     TEXT,
  first_name   TEXT,
  campaign_id  UUID REFERENCES tg_campaigns(id),
  status       TEXT DEFAULT 'pending',  -- pending, sent, failed, skipped
  sent_at      TIMESTAMPTZ,
  error_message TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_tg_leads_campaign ON tg_leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_tg_leads_status   ON tg_leads(status);
CREATE INDEX IF NOT EXISTS idx_tg_bots_status    ON tg_bots(status);

-- RPC: increment sent count for TG campaign
CREATE OR REPLACE FUNCTION increment_tg_campaign_sent(campaign_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE tg_campaigns SET total_sent = total_sent + 1 WHERE id = campaign_id;
END;
$$ LANGUAGE plpgsql;

-- RPC: increment error count for TG campaign
CREATE OR REPLACE FUNCTION increment_tg_campaign_errors(campaign_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE tg_campaigns SET total_errors = total_errors + 1 WHERE id = campaign_id;
END;
$$ LANGUAGE plpgsql;
