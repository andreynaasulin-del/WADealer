-- ============================================================================
-- Migration 008: Multioperator System
-- Teams, roles, resource assignments, dialog transfers, internal notes
-- ============================================================================

-- ── 1. Teams ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wa_teams (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  owner_id         UUID NOT NULL REFERENCES wa_users(id) ON DELETE CASCADE,
  distribution_mode TEXT NOT NULL DEFAULT 'manual' CHECK (distribution_mode IN ('manual','round_robin','least_loaded')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. Team Members ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wa_team_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES wa_teams(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES wa_users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin','manager','operator')),
  status      TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online','busy','offline')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(team_id, user_id)
);

-- ── 3. Resource Assignments ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wa_resource_assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       UUID NOT NULL REFERENCES wa_teams(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES wa_users(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('wa_session','tg_account')),
  resource_id   TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(resource_type, resource_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_resource_assignments_user ON wa_resource_assignments(user_id, resource_type);
CREATE INDEX IF NOT EXISTS idx_resource_assignments_team ON wa_resource_assignments(team_id);

-- ── 4. Dialog Transfers ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wa_dialog_transfers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id         UUID NOT NULL REFERENCES wa_teams(id) ON DELETE CASCADE,
  from_user_id    UUID REFERENCES wa_users(id),
  to_user_id      UUID REFERENCES wa_users(id),
  contact_phone   TEXT NOT NULL,
  channel         TEXT NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp','telegram')),
  note            TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dialog_transfers_to ON wa_dialog_transfers(to_user_id, status);

-- ── 5. Internal Notes ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wa_internal_notes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       UUID NOT NULL REFERENCES wa_teams(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES wa_users(id),
  contact_phone TEXT NOT NULL,
  channel       TEXT NOT NULL DEFAULT 'whatsapp',
  note          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_internal_notes_contact ON wa_internal_notes(team_id, contact_phone, channel);

-- ── 6. Team Invites ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wa_team_invites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES wa_teams(id) ON DELETE CASCADE,
  token       TEXT UNIQUE NOT NULL,
  role        TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin','manager','operator')),
  email       TEXT,
  is_used     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ
);

-- ── 7. ALTER existing tables ────────────────────────────────────────────────

-- Add role to wa_users
ALTER TABLE wa_users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'operator';

-- Add team_id to existing resource tables
ALTER TABLE wa_sessions ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES wa_teams(id);
ALTER TABLE tg_accounts ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES wa_teams(id);
ALTER TABLE wa_campaigns ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES wa_users(id);
ALTER TABLE wa_campaigns ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES wa_teams(id);

-- tg_campaigns may or may not exist
DO $$ BEGIN
  ALTER TABLE tg_campaigns ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES wa_users(id);
  ALTER TABLE tg_campaigns ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES wa_teams(id);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ── 8. Migrate existing admin data ──────────────────────────────────────────

-- Set role for existing users
UPDATE wa_users SET role = 'admin' WHERE is_admin = true AND (role IS NULL OR role = 'operator');

-- Create default team for existing admin (if no teams exist)
DO $$
DECLARE
  admin_id UUID;
  team_id UUID;
BEGIN
  -- Find the admin user
  SELECT id INTO admin_id FROM wa_users WHERE is_admin = true LIMIT 1;

  IF admin_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM wa_teams LIMIT 1) THEN
    -- Create default team
    INSERT INTO wa_teams (id, name, owner_id)
    VALUES (gen_random_uuid(), 'Default Team', admin_id)
    RETURNING id INTO team_id;

    -- Add admin as team member
    INSERT INTO wa_team_members (team_id, user_id, role, status)
    VALUES (team_id, admin_id, 'admin', 'online');

    -- Assign all existing WA sessions to this team
    UPDATE wa_sessions SET team_id = team_id WHERE team_id IS NULL;

    -- Assign all existing TG accounts to this team
    UPDATE tg_accounts SET team_id = team_id WHERE team_id IS NULL;

    -- Assign all existing campaigns to this team
    UPDATE wa_campaigns SET team_id = team_id, user_id = admin_id WHERE team_id IS NULL;

    RAISE NOTICE 'Created default team % for admin %', team_id, admin_id;
  END IF;
END $$;

-- ── 9. RLS policies (basic) ─────────────────────────────────────────────────
ALTER TABLE wa_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_resource_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_dialog_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_internal_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_team_invites ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS, so these policies are for future direct-access scenarios
DO $$ BEGIN
  CREATE POLICY "teams_service_role" ON wa_teams FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "team_members_service_role" ON wa_team_members FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "resource_assignments_service_role" ON wa_resource_assignments FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "dialog_transfers_service_role" ON wa_dialog_transfers FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "internal_notes_service_role" ON wa_internal_notes FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "team_invites_service_role" ON wa_team_invites FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
