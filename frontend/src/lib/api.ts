const BASE = '/api'  // proxied to backend via next.config.ts rewrites
const AUTH_STORAGE_KEY = 'wa_dealer_auth_token'

function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(AUTH_STORAGE_KEY)
}

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = getAuthToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(opts?.headers as Record<string, string> || {}),
  }

  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers,
  })

  // Handle 401 — redirect to login
  if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/')) {
    localStorage.removeItem(AUTH_STORAGE_KEY)
    window.location.href = '/login'
    throw new Error('Unauthorized')
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || res.statusText)
  }
  if (res.status === 204) return undefined as T
  return res.json()
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
    start: (id: string) => req<void>(`/campaigns/${id}/start`, { method: 'PUT' }),
    pause: (id: string) => req<void>(`/campaigns/${id}/pause`, { method: 'PUT' }),
    stop:  (id: string) => req<void>(`/campaigns/${id}/stop`,  { method: 'PUT' }),
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

  crm: {
    conversations: () => req<Conversation[]>('/crm/conversations'),
    messages: (phone: string, limit = 50, offset = 0) =>
      req<WaMessage[]>(`/crm/conversations/${encodeURIComponent(phone)}?limit=${limit}&offset=${offset}`),
    send: (phone: string, text: string, session_phone?: string) =>
      req<{ ok: boolean; from: string; to: string }>(`/crm/conversations/${encodeURIComponent(phone)}/send`, {
        method: 'POST', body: JSON.stringify({ text, session_phone }),
      }),
  },

  telegram: {
    accounts: {
      list: () => req<TelegramAccount[]>('/telegram/accounts'),
      create: (phone: string) =>
        req<TelegramAccount>('/telegram/accounts', { method: 'POST', body: JSON.stringify({ phone }) }),
      requestCode: (id: string) =>
        req<{ status: string }>(`/telegram/accounts/${id}/request-code`, { method: 'POST', body: '{}' }),
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
      start: (id: string) => req<void>(`/telegram/campaigns/${id}/start`, { method: 'PUT' }),
      pause: (id: string) => req<void>(`/telegram/campaigns/${id}/pause`, { method: 'PUT' }),
      stop:  (id: string) => req<void>(`/telegram/campaigns/${id}/stop`,  { method: 'PUT' }),
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
  },
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Session {
  id: string
  phone: string
  status: 'initializing' | 'qr_pending' | 'online' | 'offline' | 'banned'
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
  created_at: string
}

export interface CreateCampaign {
  name: string
  template_text: string
  session_id?: string
  delay_min_sec?: number
  delay_max_sec?: number
  ai_criteria?: string
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
  status: 'disconnected' | 'awaiting_code' | 'awaiting_password' | 'active' | 'error'
  error_msg: string | null
  connectedAt: string | null
  created_at: string
  updated_at: string
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
