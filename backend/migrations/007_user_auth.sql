-- ============================================================
-- WADealer Migration 007 — Email/Password Auth + User Isolation
-- Запустить через: Supabase Dashboard → SQL Editor
-- ============================================================

-- ─── 1. Add password_hash column to wa_users ─────────────────────────────────
ALTER TABLE public.wa_users
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- ─── 2. Update admin user email ──────────────────────────────────────────────
UPDATE public.wa_users
  SET email = 'duhdeveloper@icloud.com'
  WHERE is_admin = true;

-- ─── 3. Bind all existing tg_accounts to admin user ─────────────────────────
UPDATE public.tg_accounts
  SET user_id = (SELECT id FROM public.wa_users WHERE is_admin = true LIMIT 1)
  WHERE user_id IS NULL;

-- ─── 4. Bind all existing wa_sessions to admin user ─────────────────────────
UPDATE public.wa_sessions
  SET user_id = (SELECT id FROM public.wa_users WHERE is_admin = true LIMIT 1)
  WHERE user_id IS NULL;

-- ─── 5. Bind all existing auth sessions to admin user ───────────────────────
UPDATE public.wa_auth_sessions
  SET user_id = (SELECT id FROM public.wa_users WHERE is_admin = true LIMIT 1)
  WHERE user_id IS NULL;

-- ─── 6. Index for email lookups ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_wa_users_email ON public.wa_users(email);
