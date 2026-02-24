-- ============================================================
-- WA Dealer: Auth tables for invite-link authentication
-- Run this SQL in Supabase Dashboard → SQL Editor
-- ============================================================

-- Invite tokens (one-time codes for gaining access)
CREATE TABLE IF NOT EXISTS wa_invite_tokens (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  token      TEXT UNIQUE NOT NULL,
  label      TEXT,                              -- optional description
  is_used    BOOLEAN DEFAULT false,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ                        -- NULL = never expires
);

-- Auth sessions (long-lived tokens after invite is redeemed)
CREATE TABLE IF NOT EXISTS wa_auth_sessions (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  token          TEXT UNIQUE NOT NULL,
  invite_id      UUID REFERENCES wa_invite_tokens(id),
  created_at     TIMESTAMPTZ DEFAULT now(),
  expires_at     TIMESTAMPTZ,
  last_active_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast token lookups
CREATE INDEX IF NOT EXISTS idx_invite_tokens_token   ON wa_invite_tokens(token);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_token   ON wa_auth_sessions(token);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON wa_auth_sessions(expires_at);
