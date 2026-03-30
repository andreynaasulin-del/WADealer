import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://sdybvuwzrcemhwavtepk.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export const isSupabaseConfigured = !!supabaseAnonKey

// Only create a real client when anon key is provided
// Use a dummy key when not configured to avoid crash — Google button will be hidden anyway
const DUMMY_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.ZopqoUt20nEV9cklpv9e3yw3PVyZLmKs5qLD6nGL1SI'

export const supabase: SupabaseClient = createClient(
  supabaseUrl,
  supabaseAnonKey || DUMMY_KEY,
  supabaseAnonKey ? undefined : { auth: { persistSession: false } },
)
