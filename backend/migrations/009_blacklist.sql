-- ============================================================================
-- Migration 009: Global Blacklist System
-- Deduplication + block complainers + global blacklist across teams
-- ============================================================================

CREATE TABLE IF NOT EXISTS wa_blacklist (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone             TEXT NOT NULL,
  reason            TEXT NOT NULL DEFAULT 'contacted'
                    CHECK (reason IN ('contacted', 'complained', 'blocked_us', 'manual', 'spam_report')),
  scope             TEXT NOT NULL DEFAULT 'team'
                    CHECK (scope IN ('team', 'global')),
  source_team_id    UUID REFERENCES wa_teams(id) ON DELETE CASCADE,
  added_by_user_id  UUID REFERENCES wa_users(id) ON DELETE SET NULL,
  contacted_by_session TEXT,
  contacted_at      TIMESTAMPTZ,
  note              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(phone, source_team_id)
);

CREATE INDEX IF NOT EXISTS idx_blacklist_phone ON wa_blacklist(phone);
CREATE INDEX IF NOT EXISTS idx_blacklist_team  ON wa_blacklist(source_team_id);
CREATE INDEX IF NOT EXISTS idx_blacklist_scope ON wa_blacklist(scope);
