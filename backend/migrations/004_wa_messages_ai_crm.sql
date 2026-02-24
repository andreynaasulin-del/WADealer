-- ============================================================
-- WA Dealer: Messages storage + AI Lead Detector + CRM
-- Run this SQL in Supabase Dashboard → SQL Editor
-- ============================================================

-- ─── wa_messages — хранение всех сообщений (входящие + исходящие) ─────────────

CREATE TABLE IF NOT EXISTS wa_messages (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_phone   TEXT NOT NULL,
  remote_phone    TEXT NOT NULL,
  direction       TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body            TEXT NOT NULL,
  wa_message_id   TEXT,
  lead_id         UUID REFERENCES leads_for_invite(id),
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_messages_remote  ON wa_messages(remote_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_messages_session ON wa_messages(session_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_messages_lead    ON wa_messages(lead_id);

-- ─── AI-колонки на leads_for_invite ──────────────────────────────────────────

ALTER TABLE leads_for_invite
  ADD COLUMN IF NOT EXISTS ai_score     TEXT,
  ADD COLUMN IF NOT EXISTS ai_reason    TEXT,
  ADD COLUMN IF NOT EXISTS ai_scored_at TIMESTAMPTZ;

-- ─── AI-критерии на wa_campaigns ─────────────────────────────────────────────

ALTER TABLE wa_campaigns
  ADD COLUMN IF NOT EXISTS ai_criteria TEXT;

-- ─── Представление wa_conversations (для CRM) ───────────────────────────────

CREATE OR REPLACE VIEW wa_conversations AS
SELECT DISTINCT ON (remote_phone)
  remote_phone,
  session_phone,
  body AS last_message,
  direction AS last_direction,
  created_at AS last_message_at
FROM wa_messages
ORDER BY remote_phone, created_at DESC;
