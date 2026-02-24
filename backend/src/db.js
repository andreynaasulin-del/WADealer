import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!key || key === 'PASTE_YOUR_SERVICE_ROLE_KEY_HERE') {
  console.warn('\n⚠️  SUPABASE_SERVICE_ROLE_KEY is not set in backend/.env')
  console.warn('   Get it from: Supabase Dashboard → Settings → API → service_role key\n')
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  key || process.env.SUPABASE_ANON_KEY || ''
)

// ─── Sessions ────────────────────────────────────────────────────────────────

export async function dbGetAllSessions() {
  const { data, error } = await supabase
    .from('wa_sessions')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function dbUpsertSession({ phone_number, proxy_string, status = 'offline' }) {
  const { data, error } = await supabase
    .from('wa_sessions')
    .upsert({ phone_number, proxy_string, status, updated_at: new Date().toISOString() }, {
      onConflict: 'phone_number',
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function dbUpdateSessionStatus(phone_number, status) {
  const { error } = await supabase
    .from('wa_sessions')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('phone_number', phone_number)
  if (error) throw error
}

export async function dbDeleteSession(phone_number) {
  const { error } = await supabase
    .from('wa_sessions')
    .delete()
    .eq('phone_number', phone_number)
  if (error) throw error
}

// ─── Campaigns ───────────────────────────────────────────────────────────────

export async function dbGetAllCampaigns() {
  const { data, error } = await supabase
    .from('wa_campaigns')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

/** Count leads per campaign (returns { campaign_id: count }) */
export async function dbGetLeadsCounts() {
  const { data, error } = await supabase
    .from('leads_for_invite')
    .select('campaign_id')
  if (error) throw error
  const counts = {}
  for (const row of data || []) {
    counts[row.campaign_id] = (counts[row.campaign_id] || 0) + 1
  }
  return counts
}

export async function dbCreateCampaign({ name, template_text, session_id, delay_min_sec = 240, delay_max_sec = 540 }) {
  const { data, error } = await supabase
    .from('wa_campaigns')
    .insert({ name, template_text, session_id, delay_min_sec, delay_max_sec })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function dbUpdateCampaign(id, updates) {
  const { data, error } = await supabase
    .from('wa_campaigns')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function dbDeleteCampaign(id) {
  const { error } = await supabase
    .from('wa_campaigns')
    .delete()
    .eq('id', id)
  if (error) throw error
}

export async function dbIncrementCampaignSent(id) {
  await supabase.rpc('increment_campaign_sent', { campaign_id: id })
}

export async function dbIncrementCampaignErrors(id) {
  await supabase.rpc('increment_campaign_errors', { campaign_id: id })
}

// ─── Leads ───────────────────────────────────────────────────────────────────

export async function dbGetLeads({ campaign_id, status, limit = 100, offset = 0 }) {
  let query = supabase
    .from('leads_for_invite')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1)

  if (campaign_id) query = query.eq('campaign_id', campaign_id)
  if (status) query = query.eq('status', status)

  const { data, error, count } = await query
  if (error) throw error
  return { data, count }
}

export async function dbGetPendingLeads(campaign_id) {
  const { data, error } = await supabase
    .from('leads_for_invite')
    .select('*')
    .eq('campaign_id', campaign_id)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function dbMarkLeadSent(id) {
  const { error } = await supabase
    .from('leads_for_invite')
    .update({ status: 'sent', sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function dbMarkLeadFailed(id, error_message) {
  const { error } = await supabase
    .from('leads_for_invite')
    .update({ status: 'failed', error_message, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function dbMarkLeadReplied(id) {
  const { error } = await supabase
    .from('leads_for_invite')
    .update({ status: 'replied', replied_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

/**
 * Import leads from Tahles contacts table into leads_for_invite.
 * Pulls all advertisements that have a WhatsApp or phone number.
 * Skips numbers already in leads_for_invite for this campaign.
 */
export async function dbImportLeadsFromTahles(campaign_id) {
  // Get existing phones for this campaign to avoid duplicates
  const { data: existing } = await supabase
    .from('leads_for_invite')
    .select('phone')
    .eq('campaign_id', campaign_id)

  const existingPhones = new Set((existing || []).map(r => r.phone))

  // Pull contacts joined with advertisements using service role (bypasses RLS)
  const { data: contacts, error } = await supabase
    .from('contacts')
    .select(`
      ad_id,
      phone,
      whatsapp,
      advertisements (
        id,
        nickname,
        city
      )
    `)

  if (error) throw error

  const leads = []
  for (const c of contacts || []) {
    const phone = (c.whatsapp || c.phone || '').replace(/\D/g, '')
    if (!phone || phone.length < 7) continue
    if (existingPhones.has(phone)) continue

    leads.push({
      phone,
      ad_id: c.ad_id,
      campaign_id,
      nickname: c.advertisements?.nickname || null,
      city: c.advertisements?.city || null,
      status: 'pending',
    })
    existingPhones.add(phone)
  }

  if (leads.length === 0) return { imported: 0 }

  // Batch insert in chunks of 500
  const CHUNK = 500
  for (let i = 0; i < leads.length; i += CHUNK) {
    const { error: insertError } = await supabase
      .from('leads_for_invite')
      .insert(leads.slice(i, i + CHUNK))
    if (insertError) throw insertError
  }

  return { imported: leads.length }
}

/** Manually add phone numbers as leads for a campaign */
export async function dbAddManualLeads(campaign_id, phones) {
  // Get existing phones to avoid duplicates
  const { data: existing } = await supabase
    .from('leads_for_invite')
    .select('phone')
    .eq('campaign_id', campaign_id)

  const existingPhones = new Set((existing || []).map(r => r.phone))

  const leads = []
  for (const raw of phones) {
    const phone = raw.replace(/\D/g, '')
    if (!phone || phone.length < 7) continue
    if (existingPhones.has(phone)) continue
    leads.push({
      phone,
      campaign_id,
      status: 'pending',
    })
    existingPhones.add(phone)
  }

  if (leads.length === 0) return { imported: 0 }

  const { error } = await supabase.from('leads_for_invite').insert(leads)
  if (error) throw error
  return { imported: leads.length }
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export async function dbGetStats() {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const [sessionsRes, sentTodayRes, queueRes, errorsRes] = await Promise.all([
    supabase.from('wa_sessions').select('status'),
    supabase
      .from('leads_for_invite')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'sent')
      .gte('sent_at', todayStart.toISOString()),
    supabase
      .from('leads_for_invite')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
    supabase
      .from('leads_for_invite')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'failed'),
  ])

  const sessions = sessionsRes.data || []
  return {
    sessions_total: sessions.length,
    sessions_online: sessions.filter(s => s.status === 'online').length,
    sessions_offline: sessions.filter(s => s.status === 'offline').length,
    sessions_banned: sessions.filter(s => s.status === 'banned').length,
    sent_today: sentTodayRes.count || 0,
    in_queue: queueRes.count || 0,
    errors: errorsRes.count || 0,
  }
}

// ─── Auth: Invite Tokens ─────────────────────────────────────────────────────

/** Generate a random hex token */
function generateToken(bytes = 32) {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('')
}

/** Create a new invite token */
export async function dbCreateInviteToken(label = null) {
  const token = generateToken()
  const { data, error } = await supabase
    .from('wa_invite_tokens')
    .insert({
      token,
      label,
      is_used: false,
      expires_at: null,  // never expires by default
    })
    .select()
    .single()
  if (error) throw error
  return data
}

/** Validate invite token — returns the token row if valid */
export async function dbValidateInviteToken(token) {
  const { data, error } = await supabase
    .from('wa_invite_tokens')
    .select('*')
    .eq('token', token)
    .single()
  if (error || !data) return null
  if (data.is_used) return null
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null
  return data
}

/** Mark invite token as used */
export async function dbUseInviteToken(id) {
  const { error } = await supabase
    .from('wa_invite_tokens')
    .update({ is_used: true, used_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

/** List all invite tokens */
export async function dbGetAllInviteTokens() {
  const { data, error } = await supabase
    .from('wa_invite_tokens')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

/** Delete an invite token */
export async function dbDeleteInviteToken(id) {
  const { error } = await supabase
    .from('wa_invite_tokens')
    .delete()
    .eq('id', id)
  if (error) throw error
}

/** Check if invite tables exist (returns true/false) */
export async function dbCheckAuthTablesExist() {
  try {
    await supabase.from('wa_invite_tokens').select('id').limit(1)
    await supabase.from('wa_auth_sessions').select('id').limit(1)
    return true
  } catch {
    return false
  }
}

/** Count existing invite tokens */
export async function dbCountInviteTokens() {
  const { count, error } = await supabase
    .from('wa_invite_tokens')
    .select('id', { count: 'exact', head: true })
  if (error) return -1  // table may not exist
  return count || 0
}

// ─── Auth: Sessions ──────────────────────────────────────────────────────────

/** Create an auth session after invite validation */
export async function dbCreateAuthSession(inviteId) {
  const token = generateToken()
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
  const { data, error } = await supabase
    .from('wa_auth_sessions')
    .insert({
      token,
      invite_id: inviteId,
      expires_at: expiresAt.toISOString(),
      last_active_at: new Date().toISOString(),
    })
    .select()
    .single()
  if (error) throw error
  return data
}

/** Validate an auth session token — returns session row or null */
export async function dbValidateAuthSession(token) {
  if (!token) return null
  const { data, error } = await supabase
    .from('wa_auth_sessions')
    .select('*')
    .eq('token', token)
    .single()
  if (error || !data) return null
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null
  // Touch last_active_at
  supabase
    .from('wa_auth_sessions')
    .update({ last_active_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(() => {})
    .catch(() => {})
  return data
}

/** Delete an auth session (logout) */
export async function dbDeleteAuthSession(token) {
  const { error } = await supabase
    .from('wa_auth_sessions')
    .delete()
    .eq('token', token)
  if (error) throw error
}

/** Count active auth sessions */
export async function dbCountAuthSessions() {
  const { count, error } = await supabase
    .from('wa_auth_sessions')
    .select('id', { count: 'exact', head: true })
    .gt('expires_at', new Date().toISOString())
  if (error) return -1
  return count || 0
}

// ─── Telegram: Accounts ─────────────────────────────────────────────────────

export async function dbGetAllTelegramAccounts() {
  const { data, error } = await supabase
    .from('tg_accounts')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

export async function dbCreateTelegramAccount(phone) {
  const { data, error } = await supabase
    .from('tg_accounts')
    .insert({
      phone,
      status: 'disconnected',
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function dbUpdateTelegramAccountStatus(id, status, errorMsg = null) {
  const updates = { status, updated_at: new Date().toISOString() }
  if (errorMsg !== null) updates.error_msg = errorMsg
  else if (status !== 'error') updates.error_msg = null

  const { error } = await supabase
    .from('tg_accounts')
    .update(updates)
    .eq('id', id)
  if (error) throw error
}

export async function dbUpdateTelegramAccountInfo(id, username, firstName, lastName, sessionString) {
  const updates = { updated_at: new Date().toISOString() }
  if (username !== undefined) updates.username = username
  if (firstName !== undefined) updates.first_name = firstName
  if (lastName !== undefined) updates.last_name = lastName
  if (sessionString !== undefined) updates.session_string = sessionString

  const { error } = await supabase
    .from('tg_accounts')
    .update(updates)
    .eq('id', id)
  if (error) throw error
}

export async function dbDeleteTelegramAccount(id) {
  const { error } = await supabase
    .from('tg_accounts')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// ─── Telegram: Campaigns ────────────────────────────────────────────────────

export async function dbGetAllTelegramCampaigns() {
  const { data, error } = await supabase
    .from('tg_campaigns')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function dbCreateTelegramCampaign({ name, template_text, account_id, delay_min_sec = 3, delay_max_sec = 8 }) {
  const { data, error } = await supabase
    .from('tg_campaigns')
    .insert({ name, template_text, account_id, delay_min_sec, delay_max_sec })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function dbUpdateTelegramCampaign(id, updates) {
  const { data, error } = await supabase
    .from('tg_campaigns')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function dbDeleteTelegramCampaign(id) {
  // Delete associated leads first
  await supabase.from('tg_leads').delete().eq('campaign_id', id)
  const { error } = await supabase.from('tg_campaigns').delete().eq('id', id)
  if (error) throw error
}

export async function dbIncrementTgCampaignSent(id) {
  await supabase.rpc('increment_tg_campaign_sent', { campaign_id: id })
}

export async function dbIncrementTgCampaignErrors(id) {
  await supabase.rpc('increment_tg_campaign_errors', { campaign_id: id })
}

// ─── Telegram: Leads ────────────────────────────────────────────────────────

export async function dbGetTelegramLeads({ campaign_id, status, limit = 100, offset = 0 }) {
  let query = supabase
    .from('tg_leads')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1)

  if (campaign_id) query = query.eq('campaign_id', campaign_id)
  if (status) query = query.eq('status', status)

  const { data, error, count } = await query
  if (error) throw error
  return { data, count }
}

export async function dbGetPendingTelegramLeads(campaign_id) {
  const { data, error } = await supabase
    .from('tg_leads')
    .select('*')
    .eq('campaign_id', campaign_id)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

export async function dbAddTelegramLeads(campaign_id, chatIds) {
  // Get existing chat_ids to avoid duplicates
  const { data: existing } = await supabase
    .from('tg_leads')
    .select('chat_id')
    .eq('campaign_id', campaign_id)

  const existingIds = new Set((existing || []).map(r => r.chat_id))

  const leads = []
  for (const raw of chatIds) {
    const chatId = raw.trim()
    if (!chatId) continue
    if (existingIds.has(chatId)) continue
    leads.push({
      chat_id: chatId,
      campaign_id,
      status: 'pending',
    })
    existingIds.add(chatId)
  }

  if (leads.length === 0) return { imported: 0 }

  const CHUNK = 500
  for (let i = 0; i < leads.length; i += CHUNK) {
    const { error } = await supabase.from('tg_leads').insert(leads.slice(i, i + CHUNK))
    if (error) throw error
  }

  return { imported: leads.length }
}

export async function dbMarkTelegramLeadSent(id) {
  const { error } = await supabase
    .from('tg_leads')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function dbMarkTelegramLeadFailed(id, error_message) {
  const { error } = await supabase
    .from('tg_leads')
    .update({ status: 'failed', error_message })
    .eq('id', id)
  if (error) throw error
}

export async function dbCountTelegramLeads(campaign_id) {
  const { count, error } = await supabase
    .from('tg_leads')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaign_id)
  if (error) return 0
  return count || 0
}

// ─── Telegram: Stats ────────────────────────────────────────────────────────

export async function dbGetTelegramStats() {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const [accountsRes, sentTodayRes, queueRes, errorsRes] = await Promise.all([
    supabase.from('tg_accounts').select('status'),
    supabase
      .from('tg_leads')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'sent')
      .gte('sent_at', todayStart.toISOString()),
    supabase
      .from('tg_leads')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
    supabase
      .from('tg_leads')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'failed'),
  ])

  const accounts = accountsRes.data || []
  return {
    accounts_total: accounts.length,
    accounts_active: accounts.filter(a => a.status === 'active').length,
    accounts_disconnected: accounts.filter(a => a.status === 'disconnected').length,
    accounts_error: accounts.filter(a => a.status === 'error').length,
    sent_today: sentTodayRes.count || 0,
    in_queue: queueRes.count || 0,
    errors: errorsRes.count || 0,
  }
}

// ─── WA Messages (CRM + AI) ─────────────────────────────────────────────────

export async function dbInsertMessage({ session_phone, remote_phone, direction, body, wa_message_id, lead_id }) {
  const { error } = await supabase
    .from('wa_messages')
    .insert({ session_phone, remote_phone, direction, body, wa_message_id, lead_id })
  if (error) throw error
}

export async function dbGetConversations(session_phone) {
  let query = supabase
    .from('wa_conversations')
    .select('*')
    .order('last_message_at', { ascending: false })

  if (session_phone) query = query.eq('session_phone', session_phone)

  const { data, error } = await query
  if (error) {
    // Table/view may not exist yet (migration 004 not run)
    if (error.code === 'PGRST205' || error.code === '42P01') return []
    throw error
  }
  return data || []
}

export async function dbGetConversationMessages(remote_phone, limit = 50, offset = 0) {
  const { data, error } = await supabase
    .from('wa_messages')
    .select('*')
    .eq('remote_phone', remote_phone)
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1)
  if (error) {
    if (error.code === 'PGRST205' || error.code === '42P01') return []
    throw error
  }
  return data || []
}

export async function dbUpdateLeadAI(lead_id, { ai_score, ai_reason }) {
  const { error } = await supabase
    .from('leads_for_invite')
    .update({ ai_score, ai_reason, ai_scored_at: new Date().toISOString() })
    .eq('id', lead_id)
  if (error) throw error
}

export async function dbGetLastOutboundMessage(remote_phone) {
  const { data, error } = await supabase
    .from('wa_messages')
    .select('*')
    .eq('remote_phone', remote_phone)
    .eq('direction', 'outbound')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  if (error) return null
  return data
}

export default supabase
