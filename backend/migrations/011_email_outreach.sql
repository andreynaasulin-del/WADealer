-- ╔════════════════════════════════════════════════════════════════════════════╗
-- ║  011 — Email Outreach tables                                             ║
-- ╚════════════════════════════════════════════════════════════════════════════╝

-- Email accounts (SMTP senders)
CREATE TABLE IF NOT EXISTS email_accounts (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  smtp_host     TEXT NOT NULL,
  smtp_port     INT NOT NULL DEFAULT 587,
  smtp_user     TEXT NOT NULL,
  smtp_pass     TEXT NOT NULL,         -- encrypted in app layer
  imap_host     TEXT,
  imap_port     INT DEFAULT 993,
  status        TEXT NOT NULL DEFAULT 'offline',  -- offline | online | error
  daily_limit   INT NOT NULL DEFAULT 50,
  sent_today    INT NOT NULL DEFAULT 0,
  last_error    TEXT,
  user_id       UUID REFERENCES wa_users(id) ON DELETE SET NULL,
  team_id       UUID REFERENCES wa_teams(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Email campaigns
CREATE TABLE IF NOT EXISTS email_campaigns (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name            TEXT NOT NULL,
  subject         TEXT NOT NULL,
  body_html       TEXT NOT NULL,
  body_text       TEXT,               -- plain-text fallback
  from_account_id UUID REFERENCES email_accounts(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'draft',  -- draft | running | paused | completed | error
  delay_min_sec   INT NOT NULL DEFAULT 60,
  delay_max_sec   INT NOT NULL DEFAULT 180,
  sent_count      INT NOT NULL DEFAULT 0,
  error_count     INT NOT NULL DEFAULT 0,
  total_leads     INT NOT NULL DEFAULT 0,
  user_id         UUID REFERENCES wa_users(id) ON DELETE SET NULL,
  team_id         UUID REFERENCES wa_teams(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Email leads (recipients per campaign)
CREATE TABLE IF NOT EXISTS email_leads (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id   UUID NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  name          TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | sent | failed | bounced | replied
  sent_at       TIMESTAMPTZ,
  error_message TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_leads_campaign ON email_leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_leads_status ON email_leads(status);
CREATE INDEX IF NOT EXISTS idx_email_accounts_team ON email_accounts(team_id);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_team ON email_campaigns(team_id);
