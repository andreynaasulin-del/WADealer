/**
 * One-time migration: create tg_girls table via Supabase SQL API.
 * Run: node src/migrate-girls.js
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const SQL = `
CREATE TABLE IF NOT EXISTS tg_girls (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id BIGINT NOT NULL UNIQUE,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  access_hash TEXT,
  bio TEXT,
  score INTEGER DEFAULT 0,
  signals TEXT[],
  source_group TEXT,
  dm_status TEXT DEFAULT 'pending',
  dm_sent_at TIMESTAMPTZ,
  dm_sent_by TEXT,
  dm_error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tg_girls_dm_status ON tg_girls(dm_status);
CREATE INDEX IF NOT EXISTS idx_tg_girls_user_id ON tg_girls(user_id);
CREATE INDEX IF NOT EXISTS idx_tg_girls_score ON tg_girls(score DESC);
`

async function migrate() {
  // Use supabase.rpc to call a raw SQL function — but that doesn't exist by default.
  // Alternative: just try to insert into the table. If it fails, table doesn't exist.
  // We'll use the supabase management API instead.

  // Actually, the simplest approach: just try an upsert with an empty test row
  // and if the table doesn't exist, create it via the Supabase Dashboard SQL Editor.

  // Let's try using fetch to the Supabase SQL endpoint
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/tg_girls?select=id&limit=1`, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    }
  })

  if (res.ok) {
    console.log('✅ tg_girls table already exists')
    return
  }

  console.log('❌ tg_girls table does not exist. Creating via workaround...')

  // Workaround: Use the Supabase Management API (requires project access token)
  // OR: Create a postgres function that can execute SQL
  // For now, let's create the exec_sql function first, then use it

  const createFnRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: SQL }),
  })

  if (createFnRes.ok) {
    console.log('✅ Table created via exec_sql')
  } else {
    console.log('⚠️ exec_sql not available. Please run this SQL in Supabase SQL Editor:')
    console.log(SQL)
  }
}

migrate().catch(console.error)
