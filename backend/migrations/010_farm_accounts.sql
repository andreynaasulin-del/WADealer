-- ============================================================================
-- Migration 010: WhatsApp Farm Accounts
-- Full lifecycle: register → verify → warmup → ready → sold → active
-- ============================================================================

CREATE TABLE IF NOT EXISTS wa_farm_accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number        TEXT UNIQUE NOT NULL,
  provider            TEXT NOT NULL DEFAULT 'manual'
                      CHECK (provider IN ('5sim', 'sms-activate', 'manual', 'user-own', 'esim', 'gsm')),
  provider_order_id   TEXT,
  cost_usd            NUMERIC(8,2),

  -- Lifecycle stage
  stage               TEXT NOT NULL DEFAULT 'registered'
                      CHECK (stage IN ('registered', 'verified', 'warming', 'ready', 'sold', 'active_user', 'banned', 'replaced')),

  -- WhatsApp session link
  session_phone       TEXT,
  proxy_string        TEXT,
  registered_at       TIMESTAMPTZ DEFAULT now(),
  verified_at         TIMESTAMPTZ,
  warmup_started_at   TIMESTAMPTZ,
  ready_at            TIMESTAMPTZ,

  -- Warmup metrics
  warmup_day          INT NOT NULL DEFAULT 0,
  messages_sent_total INT NOT NULL DEFAULT 0,
  messages_received_total INT NOT NULL DEFAULT 0,
  groups_joined       INT NOT NULL DEFAULT 0,
  status_updates      INT NOT NULL DEFAULT 0,
  health_score        INT NOT NULL DEFAULT 0,
  last_activity_at    TIMESTAMPTZ,
  has_avatar          BOOLEAN NOT NULL DEFAULT false,
  has_status          BOOLEAN NOT NULL DEFAULT false,
  display_name        TEXT,

  -- Sale / ownership
  sold_to_user_id     UUID,
  sold_at             TIMESTAMPTZ,
  sale_price_usd      NUMERIC(8,2),
  owner_user_id       UUID,
  owner_type          TEXT NOT NULL DEFAULT 'platform'
                      CHECK (owner_type IN ('platform', 'user')),

  -- Ban tracking
  ban_count           INT NOT NULL DEFAULT 0,
  last_ban_at         TIMESTAMPTZ,
  ban_reason          TEXT,
  replaced_by         UUID,

  team_id             UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_farm_stage ON wa_farm_accounts(stage);
CREATE INDEX IF NOT EXISTS idx_farm_owner ON wa_farm_accounts(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_farm_sold  ON wa_farm_accounts(sold_to_user_id);
CREATE INDEX IF NOT EXISTS idx_farm_health ON wa_farm_accounts(health_score DESC);
