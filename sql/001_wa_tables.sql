-- ============================================================
-- WhatsApp Dealer — новые таблицы в базе Tahles (Supabase)
-- Запустить через: Supabase Dashboard → SQL Editor
-- ============================================================

-- ─── wa_sessions ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wa_sessions (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number   TEXT        UNIQUE NOT NULL,
  proxy_string   TEXT        NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'offline'
                   CHECK (status IN ('online', 'offline', 'banned', 'qr_pending', 'initializing')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── wa_campaigns ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wa_campaigns (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT        NOT NULL,
  template_text     TEXT        NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'stopped'
                      CHECK (status IN ('running', 'paused', 'stopped')),
  session_id        UUID        REFERENCES public.wa_sessions(id) ON DELETE SET NULL,
  delay_min_sec     INTEGER     NOT NULL DEFAULT 240,   -- 4 минуты
  delay_max_sec     INTEGER     NOT NULL DEFAULT 540,   -- 9 минут
  composing_min_ms  INTEGER     NOT NULL DEFAULT 8000,  -- 8 секунд
  composing_max_ms  INTEGER     NOT NULL DEFAULT 12000, -- 12 секунд
  sent_today        INTEGER     NOT NULL DEFAULT 0,
  total_sent        INTEGER     NOT NULL DEFAULT 0,
  total_errors      INTEGER     NOT NULL DEFAULT 0,
  last_sent_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── leads_for_invite ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leads_for_invite (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         TEXT        NOT NULL,
  ad_id         UUID,                          -- ссылка на advertisements.id (без FK)
  campaign_id   UUID        REFERENCES public.wa_campaigns(id) ON DELETE SET NULL,
  nickname      TEXT,
  city          TEXT,
  status        TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'sent', 'replied', 'failed', 'skipped')),
  error_message TEXT,
  sent_at       TIMESTAMPTZ,
  replied_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Индексы ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_leads_status      ON public.leads_for_invite(status);
CREATE INDEX IF NOT EXISTS idx_leads_campaign    ON public.leads_for_invite(campaign_id);
CREATE INDEX IF NOT EXISTS idx_leads_phone       ON public.leads_for_invite(phone);
CREATE INDEX IF NOT EXISTS idx_campaigns_status  ON public.wa_campaigns(status);

-- ─── updated_at триггер ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER wa_sessions_updated_at
  BEFORE UPDATE ON public.wa_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER wa_campaigns_updated_at
  BEFORE UPDATE ON public.wa_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER leads_for_invite_updated_at
  BEFORE UPDATE ON public.leads_for_invite
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── RPC-функции (для атомарных инкрементов) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.increment_campaign_sent(campaign_id UUID)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.wa_campaigns
  SET total_sent  = total_sent + 1,
      sent_today  = sent_today + 1,
      last_sent_at = NOW(),
      updated_at  = NOW()
  WHERE id = campaign_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_campaign_errors(campaign_id UUID)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.wa_campaigns
  SET total_errors = total_errors + 1,
      updated_at   = NOW()
  WHERE id = campaign_id;
END;
$$;

-- ─── Сброс счётчика sent_today каждую ночь ───────────────────────────────────
-- Запустить как отдельный cron job в Supabase (pg_cron), если есть:
-- SELECT cron.schedule('0 0 * * *', $$
--   UPDATE wa_campaigns SET sent_today = 0;
-- $$);

-- ─── RLS (Row Level Security) — только service role может писать ─────────────
ALTER TABLE public.wa_sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_campaigns      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads_for_invite  ENABLE ROW LEVEL SECURITY;

-- Бэкенд использует SERVICE ROLE KEY → обходит RLS без политик
-- Фронтенд не делает прямых запросов в Supabase (только через наш бэкенд)
-- Политики не нужны — всё через API

COMMENT ON TABLE public.wa_sessions       IS 'WhatsApp Dealer — активные Baileys-сессии';
COMMENT ON TABLE public.wa_campaigns      IS 'WhatsApp Dealer — кампании рассылки';
COMMENT ON TABLE public.leads_for_invite  IS 'WhatsApp Dealer — лиды для приглашения (990 анкет из Tahles)';
