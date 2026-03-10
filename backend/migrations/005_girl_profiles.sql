-- 005_girl_profiles.sql
-- Girl profile pages for invitation campaigns

-- ─── Girl Profiles table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS girl_profiles (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                  TEXT UNIQUE NOT NULL,
  name                  TEXT NOT NULL,
  city                  TEXT,
  address               TEXT,
  age                   INTEGER,
  nationality           TEXT,
  price_text            TEXT,
  price_min             INTEGER,
  price_max             INTEGER,
  incall_outcall        TEXT,
  independent_or_agency TEXT,
  services              JSONB DEFAULT '[]'::jsonb,
  availability          TEXT,
  description           TEXT,
  photos                JSONB DEFAULT '[]'::jsonb,
  is_published          BOOLEAN DEFAULT true,
  lead_id               UUID,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_girl_profiles_slug ON girl_profiles(slug);
CREATE INDEX IF NOT EXISTS idx_girl_profiles_published ON girl_profiles(is_published) WHERE is_published = true;

-- ─── Link campaigns to girl profiles ────────────────────────────────────────
ALTER TABLE wa_campaigns
  ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES girl_profiles(id) ON DELETE SET NULL;

-- ─── Exclude leads from becoming profiles ───────────────────────────────────
ALTER TABLE leads_for_invite
  ADD COLUMN IF NOT EXISTS profile_excluded BOOLEAN DEFAULT false;
