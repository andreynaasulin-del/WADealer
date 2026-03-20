const BASE = '/api'  // proxied to backend via next.config.ts rewrites
const AUTH_STORAGE_KEY = 'wa_dealer_auth_token'

function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(AUTH_STORAGE_KEY)
}

// No demo mode — always use real backend

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = getAuthToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(opts?.headers as Record<string, string> || {}),
  }

  // Try real backend — no mock fallback
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, { ...opts, headers })
  } catch (_e) {
    void _e
    throw new Error('Сервер недоступен')
  }

  // Handle 401 — redirect to login
  if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/')) {
    localStorage.removeItem(AUTH_STORAGE_KEY)
    window.location.href = '/login'
    throw new Error('Unauthorized')
  }

  // Parse JSON
  let json: T
  try {
    const text = await res.text()
    if (!text || res.status === 204) return undefined as T
    json = JSON.parse(text) as T
  } catch (_e) {
    void _e
    throw new Error('Сервер вернул невалидный ответ')
  }

  if (!res.ok) {
    const errObj = json as Record<string, unknown>
    throw new Error((errObj?.error as string) || res.statusText)
  }

  return json
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

export const api = {
  sessions: {
    list: () => req<Session[]>('/sessions'),
    create: (phone: string, proxy?: string) =>
      req<Session>('/sessions', { method: 'POST', body: JSON.stringify({ phone, ...(proxy ? { proxy } : {}) }) }),
    connect: (phone: string) =>
      req<{ phone: string; status: string }>(`/sessions/${encodeURIComponent(phone)}/connect`, { method: 'POST', body: '{}' }),
    remove: (phone: string) =>
      req<void>(`/sessions/${encodeURIComponent(phone)}`, { method: 'DELETE' }),
    qr: (phone: string) =>
      req<{ qrCode: string } | null>(`/sessions/${encodeURIComponent(phone)}/qr`),
    pairingCode: (phone: string) =>
      req<{ ok: boolean; code?: string; message: string }>(`/sessions/${encodeURIComponent(phone)}/pairing-code`, { method: 'POST', body: '{}' }),
    send: (phone: string, to: string, text: string) =>
      req<{ ok: boolean; to: string; from: string }>(`/sessions/${encodeURIComponent(phone)}/send`, {
        method: 'POST', body: JSON.stringify({ to, text }),
      }),
  },

  campaigns: {
    list: () => req<Campaign[]>('/campaigns'),
    create: (data: CreateCampaign) =>
      req<Campaign>('/campaigns', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<Campaign>) =>
      req<Campaign>(`/campaigns/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id: string) =>
      req<void>(`/campaigns/${id}`, { method: 'DELETE' }),
    start: (id: string) => req<void>(`/campaigns/${id}/start`, { method: 'PUT', body: '{}' }),
    pause: (id: string) => req<void>(`/campaigns/${id}/pause`, { method: 'PUT', body: '{}' }),
    stop:  (id: string) => req<void>(`/campaigns/${id}/stop`,  { method: 'PUT', body: '{}' }),
    queue: () => req<{ status: string; size: number }>('/campaigns/queue'),
  },

  leads: {
    list: (params?: { campaign_id?: string; status?: string; limit?: number; offset?: number }) => {
      const qs = new URLSearchParams(params as Record<string, string>).toString()
      return req<{ data: Lead[]; count: number }>(`/leads${qs ? `?${qs}` : ''}`)
    },
    import: (campaign_id: string) =>
      req<{ imported: number }>('/leads/import', {
        method: 'POST',
        body: JSON.stringify({ campaign_id }),
      }),
    add: (campaign_id: string, phones: string[]) =>
      req<{ imported: number }>('/leads/add', {
        method: 'POST',
        body: JSON.stringify({ campaign_id, phones }),
      }),
    batchScore: () =>
      req<{ ok: boolean; total: number; scored: number; errors: number; skipped: number }>('/leads/batch-score', {
        method: 'POST',
        body: '{}',
      }),
    feed: (minScore = 20, limit = 200) =>
      req<{ ok: boolean; total: number; returned: number; leads: FeedLead[] }>(
        `/leads/feed?min_score=${minScore}&limit=${limit}`
      ),
  },

  stats: {
    get: () => req<Stats>('/stats'),
  },

  auth: {
    generateInvite: (label?: string) =>
      req<InviteToken>('/auth/invite', { method: 'POST', body: JSON.stringify({ label }) }),
    listInvites: () => req<InviteToken[]>('/auth/invites'),
    deleteInvite: (id: string) => req<void>(`/auth/invite/${id}`, { method: 'DELETE' }),
  },

  ai: {
    chat: (messages: { role: 'user' | 'assistant'; content: string }[], context?: string) =>
      req<{ reply: string }>('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ messages, context }),
      }),
    suggestTemplate: (business: string, goal?: string, tone?: string) =>
      req<{ templates: { text: string; description: string }[] }>('/ai/suggest-template', {
        method: 'POST',
        body: JSON.stringify({ business, goal, tone }),
      }),
    replySuggest: (leadMessage: string, ourMessage?: string, goal?: string) =>
      req<{ replies: { text: string; strategy: string }[] }>('/ai/reply-suggest', {
        method: 'POST',
        body: JSON.stringify({ leadMessage, ourMessage, goal }),
      }),
  },

  crm: {
    conversations: (campaignId?: string) =>
      req<Conversation[]>(`/crm/conversations${campaignId ? `?campaign_id=${campaignId}` : ''}`),
    messages: (phone: string, limit = 50, offset = 0) =>
      req<WaMessage[]>(`/crm/conversations/${encodeURIComponent(phone)}?limit=${limit}&offset=${offset}`),
    send: (phone: string, text: string, session_phone?: string) =>
      req<{ ok: boolean; from: string; to: string }>(`/crm/conversations/${encodeURIComponent(phone)}/send`, {
        method: 'POST', body: JSON.stringify({ text, session_phone }),
      }),
  },

  profiles: {
    list: () => req<GirlProfile[]>('/profiles'),
    get: (slug: string) => req<GirlProfile>(`/public/profile/${slug}`),
    create: (data: Partial<GirlProfile>) =>
      req<GirlProfile>('/profiles', { method: 'POST', body: JSON.stringify(data) }),
    createFromLead: (leadId: string) =>
      req<GirlProfile>(`/profiles/from-lead/${leadId}`, { method: 'POST', body: '{}' }),
    update: (id: string, data: Partial<GirlProfile>) =>
      req<GirlProfile>(`/profiles/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id: string) =>
      req<void>(`/profiles/${id}`, { method: 'DELETE' }),
    excludeLead: (leadId: string, excluded: boolean) =>
      req<void>(`/leads/${leadId}/exclude`, { method: 'PUT', body: JSON.stringify({ excluded }) }),
  },

  telegram: {
    accounts: {
      list: () => req<TelegramAccount[]>('/telegram/accounts'),
      create: (phone: string) =>
        req<TelegramAccount>('/telegram/accounts', { method: 'POST', body: JSON.stringify({ phone }) }),
      requestCode: (id: string) =>
        req<{ status: string }>(`/telegram/accounts/${id}/request-code`, { method: 'POST', body: '{}' }),
      qrLogin: (id: string) =>
        req<{ status: string; qr_data_url?: string }>(`/telegram/accounts/${id}/qr-login`, { method: 'POST', body: '{}' }),
      verifyCode: (id: string, code: string) =>
        req<{ status: string; username?: string; firstName?: string }>(`/telegram/accounts/${id}/verify-code`, {
          method: 'POST', body: JSON.stringify({ code }),
        }),
      verifyPassword: (id: string, password: string) =>
        req<{ status: string; username?: string; firstName?: string }>(`/telegram/accounts/${id}/verify-password`, {
          method: 'POST', body: JSON.stringify({ password }),
        }),
      connect: (id: string) =>
        req<{ status: string }>(`/telegram/accounts/${id}/connect`, { method: 'POST', body: '{}' }),
      disconnect: (id: string) =>
        req<{ id: string; status: string }>(`/telegram/accounts/${id}/disconnect`, { method: 'POST', body: '{}' }),
      remove: (id: string) =>
        req<void>(`/telegram/accounts/${id}`, { method: 'DELETE' }),
      send: (id: string, chatId: string, text: string) =>
        req<{ ok: boolean }>(`/telegram/accounts/${id}/send`, {
          method: 'POST', body: JSON.stringify({ chat_id: chatId, text }),
        }),
    },
    campaigns: {
      list: () => req<TelegramCampaign[]>('/telegram/campaigns'),
      create: (data: CreateTelegramCampaign) =>
        req<TelegramCampaign>('/telegram/campaigns', { method: 'POST', body: JSON.stringify(data) }),
      update: (id: string, data: Partial<TelegramCampaign>) =>
        req<TelegramCampaign>(`/telegram/campaigns/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
      remove: (id: string) =>
        req<void>(`/telegram/campaigns/${id}`, { method: 'DELETE' }),
      start: (id: string) => req<void>(`/telegram/campaigns/${id}/start`, { method: 'PUT', body: '{}' }),
      pause: (id: string) => req<void>(`/telegram/campaigns/${id}/pause`, { method: 'PUT', body: '{}' }),
      stop:  (id: string) => req<void>(`/telegram/campaigns/${id}/stop`,  { method: 'PUT', body: '{}' }),
    },
    leads: {
      list: (params?: { campaign_id?: string; status?: string; limit?: number; offset?: number }) => {
        const qs = new URLSearchParams(params as Record<string, string>).toString()
        return req<{ data: TelegramLead[]; count: number }>(`/telegram/leads${qs ? `?${qs}` : ''}`)
      },
      add: (campaign_id: string, chat_ids: string[]) =>
        req<{ imported: number }>('/telegram/leads/add', {
          method: 'POST', body: JSON.stringify({ campaign_id, chat_ids }),
        }),
    },
    stats: {
      get: () => req<TelegramStats>('/telegram/stats'),
    },
    sourceGroups: {
      list: () => req<SourceGroup[]>('/telegram/source-groups'),
      add: (links: string[]) =>
        req<SourceGroup[]>('/telegram/source-groups', { method: 'POST', body: JSON.stringify({ links }) }),
      remove: (id: string) =>
        req<void>(`/telegram/source-groups/${id}`, { method: 'DELETE' }),
    },
    scrape: {
      start: (accountId: string, groupId?: string) =>
        req<{ ok: boolean }>('/telegram/scrape/start', {
          method: 'POST', body: JSON.stringify({ account_id: accountId, group_id: groupId }),
        }),
      stop: () => req<{ ok: boolean }>('/telegram/scrape/stop', { method: 'POST', body: '{}' }),
      status: () => req<ScrapeStatus>('/telegram/scrape/status'),
    },
    scrapedMembers: {
      list: (params?: { invite_status?: string; limit?: number; offset?: number }) => {
        const qs = new URLSearchParams(params as Record<string, string>).toString()
        return req<{ data: ScrapedMember[]; count: number }>(`/telegram/scraped-members${qs ? `?${qs}` : ''}`)
      },
      stats: () => req<ScrapedMembersStats>('/telegram/scraped-members/stats'),
    },
    invite: {
      start: (accountId: string, targetChannel: string, dailyLimit?: number) =>
        req<{ ok: boolean }>('/telegram/invite/start', {
          method: 'POST', body: JSON.stringify({ account_id: accountId, target_channel: targetChannel, daily_limit: dailyLimit }),
        }),
      multiStart: (channels: string[], dailyLimitPerAccount?: number, delayBetweenInvitesSec?: number) =>
        req<{ ok: boolean }>('/telegram/invite/multi-start', {
          method: 'POST', body: JSON.stringify({ channels, daily_limit_per_account: dailyLimitPerAccount, delay_between_invites_sec: delayBetweenInvitesSec }),
        }),
      multiStop: () => req<{ ok: boolean }>('/telegram/invite/multi-stop', { method: 'POST', body: '{}' }),
      stop: () => req<{ ok: boolean }>('/telegram/invite/stop', { method: 'POST', body: '{}' }),
      status: () => req<InviteStatus>('/telegram/invite/status'),
    },
    settings: {
      get: (accountId: string) => req<AccountSettings>(`/telegram/accounts/${accountId}/settings`),
      update: (accountId: string, settings: Partial<AccountSettings>) =>
        req<AccountSettings>(`/telegram/accounts/${accountId}/settings`, {
          method: 'PUT', body: JSON.stringify({ settings }),
        }),
      updateProxy: (accountId: string, proxyString: string | null) =>
        req<{ id: string; proxy_string: string | null }>(`/telegram/accounts/${accountId}/proxy`, {
          method: 'PUT', body: JSON.stringify({ proxy_string: proxyString }),
        }),
    },
  },

  // ─── Dashboard ──────────────────────────────────────────────────────────────
  dashboard: {
    get: () => req<DashboardStats>('/dashboard'),
    tiers: () => req<Tier[]>('/tiers'),
    heartbeat: () => req<{ ok: boolean; ts: string }>('/heartbeat'),
  },
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Session {
  id: string
  phone: string
  status: 'initializing' | 'qr_pending' | 'online' | 'offline' | 'banned' | 'pairing_pending' | 'reconnecting'
  qrCode: string | null
  proxyPort: string | null
  connectedAt: string | null
}

export interface Campaign {
  id: string
  name: string
  template_text: string
  status: 'running' | 'paused' | 'stopped'
  session_id: string | null
  delay_min_sec: number
  delay_max_sec: number
  sent_today: number
  total_sent: number
  total_errors: number
  total_leads: number
  ai_criteria: string | null
  profile_id: string | null
  created_at: string
}

export interface CreateCampaign {
  name: string
  template_text: string
  session_id?: string
  delay_min_sec?: number
  delay_max_sec?: number
  ai_criteria?: string
  profile_id?: string
}

export interface Lead {
  id: string
  phone: string
  ad_id: string | null
  campaign_id: string
  nickname: string | null
  city: string | null
  status: 'pending' | 'sent' | 'replied' | 'failed' | 'skipped'
  sent_at: string | null
  error_message: string | null
  ai_score: 'hot' | 'warm' | 'cold' | 'irrelevant' | null
  ai_reason: string | null
  created_at: string
}

export interface Stats {
  sessions_total: number
  sessions_online: number
  sessions_offline: number
  sessions_banned: number
  sent_today: number
  in_queue: number
  errors: number
  queue_status: string
  queue_size: number
}

export interface InviteToken {
  id: string
  token: string
  label: string | null
  is_used: boolean
  used_at: string | null
  created_at: string
  expires_at: string | null
}

// ─── Telegram Types ──────────────────────────────────────────────────────────

export interface TelegramAccount {
  id: string
  phone: string
  username: string | null
  first_name: string | null
  last_name: string | null
  status: 'disconnected' | 'awaiting_code' | 'awaiting_password' | 'qr_pending' | 'active' | 'error'
  error_msg: string | null
  connectedAt: string | null
  proxyString: string | null
  reconnectAttempts: number
  settings?: AccountSettings
  created_at: string
  updated_at: string
}

// ─── Account Settings Types ─────────────────────────────────────────────────

export interface InvitingSettings {
  enabled: boolean
  daily_limit: number
  delay_min: number
  delay_max: number
  channels: string[]
}

export interface StoryLikingSettings {
  enabled: boolean
  interval_min: number
  interval_max: number
  like_probability: number
}

export interface NeuroCommentingSettings {
  enabled: boolean
  ai_model: 'grok' | 'claude' | 'gpt'
  comment_interval_min: number
  comment_interval_max: number
  max_daily: number
}

export interface MassDmSettings {
  enabled: boolean
  daily_limit: number
  delay_min: number
  delay_max: number
  template: string
}

export interface AccountSettings {
  inviting: InvitingSettings
  story_liking: StoryLikingSettings
  neuro_commenting: NeuroCommentingSettings
  mass_dm: MassDmSettings
}

// ─── Dashboard Types ─────────────────────────────────────────────────────────

export interface DashboardStats {
  whatsapp: Stats
  telegram: TelegramStats
  scraped: ScrapedMembersStats
  heartbeat: {
    tg_alive: number
    tg_dead: number
    wa_alive: number
    wa_dead: number
  }
  queues: {
    wa: { status: string; size: number }
    tg: { status: string; size: number }
  }
  activity: Record<string, number>
  campaigns: {
    wa_running: number
    wa_total: number
    tg_running: number
    tg_total: number
  }
  invite: InviteStatus
  scrape: ScrapeStatus
}

export interface Tier {
  id: string
  display_name: string
  max_tg_accounts: number
  max_wa_sessions: number
  max_daily_messages: number
  features: Record<string, boolean>
  price_monthly: number
}

export interface TelegramCampaign {
  id: string
  name: string
  template_text: string
  status: 'draft' | 'running' | 'paused' | 'stopped' | 'completed'
  account_id: string | null
  delay_min_sec: number
  delay_max_sec: number
  total_sent: number
  total_errors: number
  total_leads?: number
  created_at: string
}

export interface CreateTelegramCampaign {
  name: string
  template_text: string
  account_id?: string
  delay_min_sec?: number
  delay_max_sec?: number
}

export interface TelegramLead {
  id: string
  chat_id: string
  username: string | null
  first_name: string | null
  campaign_id: string
  status: 'pending' | 'sent' | 'failed' | 'skipped'
  sent_at: string | null
  error_message: string | null
  created_at: string
}

export interface TelegramStats {
  accounts_total: number
  accounts_active: number
  accounts_disconnected: number
  accounts_error: number
  sent_today: number
  in_queue: number
  errors: number
  queue_status?: string
  queue_size?: number
}

export interface SourceGroup {
  id: string
  link: string
  username: string | null
  invite_hash: string | null
  title: string | null
  member_count: number | null
  joined: boolean
  scraped_at: string | null
  status: 'pending' | 'joined' | 'scraping' | 'scraped' | 'error'
  error_msg: string | null
  created_at: string
}

export interface ScrapedMember {
  id: string
  user_id: number
  username: string | null
  first_name: string | null
  last_name: string | null
  access_hash: string | null
  source_group_id: string | null
  is_bot: boolean
  invite_status: 'pending' | 'invited' | 'failed' | 'skipped'
  invite_error: string | null
  invited_at: string | null
  created_at: string
}

export interface ScrapedMembersStats {
  pending: number
  invited: number
  failed: number
  skipped: number
  total: number
}

export interface ScrapeStatus {
  status: 'idle' | 'running' | 'completed' | 'stopped'
  progress?: number
  total?: number
}

export interface InviteStatus {
  status: 'idle' | 'running' | 'completed' | 'stopped' | 'rate_limited'
  invited?: number
  failed?: number
  dailyLimit?: number
}

export interface FeedLead {
  id: string
  phone: string
  nickname: string | null
  profile_excluded: boolean
  score: number
  category: 'HOT' | 'WARM' | 'COLD' | 'IRRELEVANT'
  city: string | null
  address: string | null
  price_text: string | null
  price_min: number | null
  price_max: number | null
  nationality: string | null
  incall_outcall: string | null
  independent_or_agency: string | null
  has_photos: boolean
  has_video: boolean
  age: number | null
  services: string[] | null
  availability: string | null
  sentiment: string | null
}

// ─── CRM Types ──────────────────────────────────────────────────────────────

export interface WaMessage {
  id: string
  session_phone: string
  remote_phone: string
  direction: 'inbound' | 'outbound'
  body: string
  wa_message_id: string | null
  lead_id: string | null
  created_at: string
}

export interface Conversation {
  remote_phone: string
  session_phone: string
  last_message: string
  last_direction: 'inbound' | 'outbound'
  last_message_at: string
}

// ─── Girl Profile Types ─────────────────────────────────────────────────────

export interface GirlProfile {
  id: string
  slug: string
  name: string
  city: string | null
  address: string | null
  age: number | null
  nationality: string | null
  price_text: string | null
  price_min: number | null
  price_max: number | null
  incall_outcall: string | null
  independent_or_agency: string | null
  services: string[] | null
  availability: string | null
  description: string | null
  photos: string[]
  is_published: boolean
  lead_id: string | null
  created_at: string
  updated_at: string
}
