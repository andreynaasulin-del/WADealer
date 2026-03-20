-- ============================================================
-- WADealer SaaS Upgrade — Migration 002
-- Запустить через: Supabase Dashboard → SQL Editor
-- ============================================================

-- ─── 1. Users table (SaaS пользователи) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wa_users (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT        UNIQUE,
  display_name   TEXT,
  tier           TEXT        NOT NULL DEFAULT 'start'
                   CHECK (tier IN ('start', 'pro', 'enterprise')),
  max_tg_accounts INTEGER   NOT NULL DEFAULT 3,
  max_wa_sessions INTEGER   NOT NULL DEFAULT 1,
  is_admin       BOOLEAN    NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Привязка auth_sessions к user
ALTER TABLE public.wa_auth_sessions
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.wa_users(id) ON DELETE SET NULL;

-- ─── 2. Per-account settings JSONB для Telegram ─────────────────────────────
-- Добавляем settings колонку в tg_accounts
ALTER TABLE public.tg_accounts
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{
    "inviting": {"enabled": false, "daily_limit": 40, "delay_min": 30, "delay_max": 90, "channels": []},
    "story_liking": {"enabled": false, "interval_min": 300, "interval_max": 900, "like_probability": 0.7},
    "neuro_commenting": {"enabled": false, "ai_model": "grok", "comment_interval_min": 600, "comment_interval_max": 1800, "max_daily": 20},
    "mass_dm": {"enabled": false, "daily_limit": 30, "delay_min": 60, "delay_max": 180, "template": ""}
  }'::jsonb;

-- Proxy индивидуально для каждого TG аккаунта
ALTER TABLE public.tg_accounts
  ADD COLUMN IF NOT EXISTS proxy_string TEXT;

-- Owner (user) привязка
ALTER TABLE public.tg_accounts
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.wa_users(id) ON DELETE SET NULL;

-- Heartbeat tracking
ALTER TABLE public.tg_accounts
  ADD COLUMN IF NOT EXISTS last_heartbeat TIMESTAMPTZ;

ALTER TABLE public.tg_accounts
  ADD COLUMN IF NOT EXISTS heartbeat_failures INTEGER NOT NULL DEFAULT 0;

-- ─── 3. Per-account settings для WhatsApp ───────────────────────────────────
ALTER TABLE public.wa_sessions
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{
    "daily_limit": 20,
    "delay_min_sec": 240,
    "delay_max_sec": 540,
    "composing_min_ms": 8000,
    "composing_max_ms": 12000,
    "auto_reply": true,
    "ai_model": "claude"
  }'::jsonb;

ALTER TABLE public.wa_sessions
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.wa_users(id) ON DELETE SET NULL;

ALTER TABLE public.wa_sessions
  ADD COLUMN IF NOT EXISTS last_heartbeat TIMESTAMPTZ;

ALTER TABLE public.wa_sessions
  ADD COLUMN IF NOT EXISTS heartbeat_failures INTEGER NOT NULL DEFAULT 0;

-- ─── 4. Tier limits reference table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wa_tiers (
  id             TEXT        PRIMARY KEY, -- 'start', 'pro', 'enterprise'
  display_name   TEXT        NOT NULL,
  max_tg_accounts INTEGER   NOT NULL,
  max_wa_sessions INTEGER   NOT NULL,
  max_daily_messages INTEGER NOT NULL,
  features       JSONB      NOT NULL DEFAULT '{}',
  price_monthly  NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.wa_tiers (id, display_name, max_tg_accounts, max_wa_sessions, max_daily_messages, features, price_monthly)
VALUES
  ('start', 'Start', 3, 1, 50, '{"inviting": true, "mass_dm": true, "story_liking": false, "neuro_commenting": false}', 0),
  ('pro', 'Pro', 15, 5, 300, '{"inviting": true, "mass_dm": true, "story_liking": true, "neuro_commenting": true}', 49.99),
  ('enterprise', 'Enterprise', 50, 20, 1000, '{"inviting": true, "mass_dm": true, "story_liking": true, "neuro_commenting": true}', 149.99)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  max_tg_accounts = EXCLUDED.max_tg_accounts,
  max_wa_sessions = EXCLUDED.max_wa_sessions,
  max_daily_messages = EXCLUDED.max_daily_messages,
  features = EXCLUDED.features,
  price_monthly = EXCLUDED.price_monthly;

-- ─── 5. Activity log table (для SaaS дашборда) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.wa_activity_log (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        REFERENCES public.wa_users(id) ON DELETE CASCADE,
  account_id     UUID,       -- tg_accounts.id or wa_sessions.id
  platform       TEXT        NOT NULL CHECK (platform IN ('telegram', 'whatsapp')),
  action         TEXT        NOT NULL, -- 'invite_sent', 'dm_sent', 'story_liked', 'comment_sent', 'message_sent'
  details        JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_user     ON public.wa_activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_account  ON public.wa_activity_log(account_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_created  ON public.wa_activity_log(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_log_action   ON public.wa_activity_log(action);

-- ─── 6. Encrypted credentials vault ─────────────────────────────────────────
-- Хранилище зашифрованных данных (AES-256)
CREATE TABLE IF NOT EXISTS public.wa_vault (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        REFERENCES public.wa_users(id) ON DELETE CASCADE,
  key_name       TEXT        NOT NULL, -- 'tg_session_<account_id>', 'wa_auth_<phone>'
  encrypted_data TEXT        NOT NULL, -- AES-256-GCM encrypted base64
  iv             TEXT        NOT NULL, -- initialization vector
  auth_tag       TEXT        NOT NULL, -- GCM auth tag
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, key_name)
);

-- ─── 7. RLS Policies ────────────────────────────────────────────────────────

-- Enable RLS on new tables
ALTER TABLE public.wa_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_vault ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_tiers ENABLE ROW LEVEL SECURITY;

-- Tiers: readable by all authenticated
CREATE POLICY "tiers_read_all" ON public.wa_tiers
  FOR SELECT USING (true);

-- Users: can only see own profile
CREATE POLICY "users_own_read" ON public.wa_users
  FOR SELECT USING (id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.wa_auth_sessions WHERE user_id = wa_users.id AND token = current_setting('request.headers', true)::json->>'authorization'
  ));

-- Activity log: users see own activity only
CREATE POLICY "activity_own_read" ON public.wa_activity_log
  FOR SELECT USING (user_id = auth.uid());

-- Vault: users access own vault only
CREATE POLICY "vault_own_read" ON public.wa_vault
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "vault_own_write" ON public.wa_vault
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "vault_own_update" ON public.wa_vault
  FOR UPDATE USING (user_id = auth.uid());

-- ─── 8. Heartbeat tracking function ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_heartbeat(
  p_table TEXT,
  p_id UUID
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_table = 'tg_accounts' THEN
    UPDATE public.tg_accounts
    SET last_heartbeat = NOW(), heartbeat_failures = 0
    WHERE id = p_id;
  ELSIF p_table = 'wa_sessions' THEN
    UPDATE public.wa_sessions
    SET last_heartbeat = NOW(), heartbeat_failures = 0
    WHERE id = p_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_heartbeat_failures(
  p_table TEXT,
  p_id UUID
)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  new_count INTEGER;
BEGIN
  IF p_table = 'tg_accounts' THEN
    UPDATE public.tg_accounts
    SET heartbeat_failures = heartbeat_failures + 1
    WHERE id = p_id
    RETURNING heartbeat_failures INTO new_count;
  ELSIF p_table = 'wa_sessions' THEN
    UPDATE public.wa_sessions
    SET heartbeat_failures = heartbeat_failures + 1
    WHERE id = p_id
    RETURNING heartbeat_failures INTO new_count;
  END IF;
  RETURN COALESCE(new_count, 0);
END;
$$;

-- ─── 9. Daily stats aggregation ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_daily_stats(p_user_id UUID DEFAULT NULL)
RETURNS JSON LANGUAGE plpgsql AS $$
DECLARE
  result JSON;
  today_start TIMESTAMPTZ := DATE_TRUNC('day', NOW());
BEGIN
  SELECT json_build_object(
    'invites_today', (SELECT COUNT(*) FROM public.wa_activity_log WHERE action = 'invite_sent' AND created_at >= today_start AND (p_user_id IS NULL OR user_id = p_user_id)),
    'dms_today', (SELECT COUNT(*) FROM public.wa_activity_log WHERE action = 'dm_sent' AND created_at >= today_start AND (p_user_id IS NULL OR user_id = p_user_id)),
    'stories_liked_today', (SELECT COUNT(*) FROM public.wa_activity_log WHERE action = 'story_liked' AND created_at >= today_start AND (p_user_id IS NULL OR user_id = p_user_id)),
    'comments_today', (SELECT COUNT(*) FROM public.wa_activity_log WHERE action = 'comment_sent' AND created_at >= today_start AND (p_user_id IS NULL OR user_id = p_user_id)),
    'wa_messages_today', (SELECT COUNT(*) FROM public.wa_activity_log WHERE action = 'message_sent' AND created_at >= today_start AND (p_user_id IS NULL OR user_id = p_user_id)),
    'total_tg_accounts', (SELECT COUNT(*) FROM public.tg_accounts WHERE (p_user_id IS NULL OR user_id = p_user_id)),
    'active_tg_accounts', (SELECT COUNT(*) FROM public.tg_accounts WHERE status = 'active' AND (p_user_id IS NULL OR user_id = p_user_id)),
    'total_wa_sessions', (SELECT COUNT(*) FROM public.wa_sessions WHERE (p_user_id IS NULL OR user_id = p_user_id)),
    'online_wa_sessions', (SELECT COUNT(*) FROM public.wa_sessions WHERE status = 'online' AND (p_user_id IS NULL OR user_id = p_user_id))
  ) INTO result;
  RETURN result;
END;
$$;

-- ─── 10. Updated_at triggers for new tables ─────────────────────────────────
CREATE OR REPLACE TRIGGER wa_users_updated_at
  BEFORE UPDATE ON public.wa_users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER wa_vault_updated_at
  BEFORE UPDATE ON public.wa_vault
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 11. Cron: reset daily counters ────────────────────────────────────────
-- Запустить через pg_cron в Supabase:
-- SELECT cron.schedule('reset_daily_counters', '0 0 * * *', $$
--   UPDATE wa_campaigns SET sent_today = 0;
--   UPDATE tg_campaigns SET sent_today = 0;
-- $$);

-- ─── 12. Create default admin user ─────────────────────────────────────────
INSERT INTO public.wa_users (email, display_name, tier, max_tg_accounts, max_wa_sessions, is_admin)
VALUES ('admin@wadealer.local', 'Admin', 'enterprise', 50, 20, true)
ON CONFLICT (email) DO UPDATE SET
  tier = 'enterprise',
  max_tg_accounts = 50,
  max_wa_sessions = 20,
  is_admin = true;
