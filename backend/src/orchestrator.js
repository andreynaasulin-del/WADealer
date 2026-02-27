import { Session } from './session.js'
import { TelegramSession } from './telegram-session.js'
import { MessageQueue } from './queue.js'
import { classifyLead } from './ai-classifier.js'
import * as db from './db.js'

/**
 * Orchestrator — singleton that manages:
 *  - Multiple Baileys sessions (one per phone number)
 *  - Multiple Telegram user account sessions
 *  - The global message queues (WhatsApp + Telegram)
 *  - WebSocket broadcasting to frontend clients
 *  - Live log streaming
 *  - Froxy proxy auto-assignment (unique port per session)
 */
export class Orchestrator {
  constructor() {
    /** @type {Map<string, Session>} phone → WhatsApp Session */
    this.sessions = new Map()

    /** @type {Map<string, TelegramSession>} accountId → TelegramSession */
    this.telegramAccounts = new Map()

    /** @type {MessageQueue} WhatsApp queue */
    this.queue = new MessageQueue(this)

    /** @type {MessageQueue} Telegram queue (separate instance) */
    this.telegramQueue = new MessageQueue(this, 'telegram')

    /** @type {Set<import('ws').WebSocket>} */
    this.wsClients = new Set()

    /** @type {typeof db} */
    this.db = db

    /** In-memory log ring buffer (last 500 entries) */
    this.logBuffer = []
    this.LOG_LIMIT = 500
  }

  // ─── Froxy proxy auto-assignment ──────────────────────────────────────────

  buildFroxyProxy(port) {
    const host = process.env.FROXY_HOST
    const user = process.env.FROXY_USER
    const pass = process.env.FROXY_PASS
    if (!host || !user || !pass) {
      throw new Error('Froxy не настроен — задай FROXY_HOST, FROXY_USER, FROXY_PASS в .env')
    }
    return `${host}:${port}:${user}:${pass}`
  }

  getNextFroxyPort() {
    const basePort = parseInt(process.env.FROXY_BASE_PORT || '10000', 10)
    const maxPort = basePort + 999
    const usedPorts = new Set()
    for (const s of this.sessions.values()) {
      const parts = s.proxyString.split(':')
      if (parts.length >= 2) usedPorts.add(parseInt(parts[1], 10))
    }
    for (let p = basePort; p <= maxPort; p++) {
      if (!usedPorts.has(p)) return p
    }
    throw new Error('Все 1000 портов Froxy заняты')
  }

  // ─── WebSocket ─────────────────────────────────────────────────────────────

  addWsClient(ws) {
    this.wsClients.add(ws)
    for (const entry of this.logBuffer) {
      try { ws.send(JSON.stringify(entry)) } catch (_) {}
    }
  }

  removeWsClient(ws) {
    this.wsClients.delete(ws)
  }

  broadcast(event) {
    const payload = JSON.stringify(event)
    for (const ws of this.wsClients) {
      try { ws.send(payload) } catch (_) { this.wsClients.delete(ws) }
    }
  }

  // ─── Logging ───────────────────────────────────────────────────────────────

  log(session, message, level = 'info', platform = 'whatsapp') {
    const entry = {
      type: 'log',
      session: session || 'SYSTEM',
      message,
      level,
      platform,
      ts: new Date().toISOString(),
    }
    this.logBuffer.push(entry)
    if (this.logBuffer.length > this.LOG_LIMIT) this.logBuffer.shift()
    this.broadcast(entry)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // WhatsApp Session management (unchanged)
  // ══════════════════════════════════════════════════════════════════════════

  async createSession(phone, proxyString) {
    if (this.sessions.has(phone)) {
      throw new Error(`Сессия ${phone} уже существует`)
    }
    if (!proxyString) {
      const port = this.getNextFroxyPort()
      proxyString = this.buildFroxyProxy(port)
      this.log(phone, `Froxy порт ${port} назначен (уникальный IP)`)
    }
    const proxyPort = proxyString.split(':')[1]
    const dbRow = await db.dbUpsertSession({ phone_number: phone, proxy_string: proxyString, status: 'offline' })
    const session = new Session(phone, proxyString, this)
    session.id = dbRow.id
    this.sessions.set(phone, session)
    this.log(phone, `Сессия добавлена → порт ${proxyPort} — нажми Подключить`)
    this.broadcast({ type: 'session_created', phone })
    return { id: dbRow.id, phone, status: 'offline', proxyPort }
  }

  async connectSession(phone) {
    const session = this.sessions.get(phone)
    if (!session) throw new Error(`Сессия ${phone} не найдена`)
    if (session.status === 'online') throw new Error(`Сессия ${phone} уже подключена`)
    session.stopped = false
    session.start()
    return { phone, status: 'initializing' }
  }

  async deleteSession(phone) {
    const session = this.sessions.get(phone)
    if (session) {
      await session.stop()
      this.sessions.delete(phone)
    }
    await db.dbDeleteSession(phone)
    this.log(phone, `Сессия ${phone} удалена`)
    this.broadcast({ type: 'session_deleted', phone })
  }

  getSessionState(phone) {
    const s = this.sessions.get(phone)
    if (!s) return null
    return {
      id: s.id, phone: s.phone, status: s.status,
      qrCode: s.qrCode, proxyPort: s.proxyString.split(':')[1] || null,
      connectedAt: s.connectedAt,
    }
  }

  getAllSessionStates() {
    return Array.from(this.sessions.values()).map(s => ({
      id: s.id, phone: s.phone, status: s.status,
      qrCode: s.qrCode, proxyPort: s.proxyString.split(':')[1] || null,
      connectedAt: s.connectedAt,
    }))
  }

  async storeMessage(sessionPhone, remotePhone, direction, body, waMessageId, leadId) {
    try {
      await db.dbInsertMessage({
        session_phone: sessionPhone,
        remote_phone: remotePhone,
        direction,
        body,
        wa_message_id: waMessageId || null,
        lead_id: leadId || null,
      })
    } catch (_) {}
    this.broadcast({
      type: 'new_message', sessionPhone, remotePhone, direction, body,
      ts: new Date().toISOString(),
    })
  }

  async handleReply(fromPhone, text, sessionPhone) {
    let leadId = null
    try {
      const { data } = await db.dbGetLeads({ status: 'sent' })
      const lead = data?.find(l => l.phone.replace(/\D/g, '') === fromPhone.replace(/\D/g, ''))
      if (lead) {
        leadId = lead.id
        await db.dbMarkLeadReplied(lead.id)
        // Trigger AI classification if reply has text
        if (text) this._classifyLead(lead, text, sessionPhone)
      }
    } catch (_) {}

    // Store inbound message for CRM
    if (text) {
      await this.storeMessage(sessionPhone, fromPhone, 'inbound', text, null, leadId)
    }
    this.broadcast({ type: 'reply_received', phone: fromPhone })
  }

  async _classifyLead(lead, inboundText, sessionPhone) {
    try {
      const campaigns = await db.dbGetAllCampaigns()
      const campaign = campaigns.find(c => c.id === lead.campaign_id)
      if (!campaign?.ai_criteria) return  // no criteria set — skip

      const outbound = await db.dbGetLastOutboundMessage(lead.phone.replace(/\D/g, ''))
      const { score, reason } = await classifyLead(
        campaign.ai_criteria,
        outbound?.body || campaign.template_text,
        inboundText,
      )

      await db.dbUpdateLeadAI(lead.id, { ai_score: score, ai_reason: reason })

      this.log(sessionPhone, `AI: ${lead.phone} → ${score} (${reason})`, 'info')
      this.broadcast({
        type: 'ai_classification',
        leadId: lead.id, phone: lead.phone,
        score, reason,
      })
    } catch (err) {
      this.log(sessionPhone, `AI ошибка: ${err.message}`, 'error')
    }
  }

  async restoreFromDB() {
    this.log(null, 'Восстановление сессий из базы данных...', 'system')
    let autoConnected = 0
    let offline = 0
    try {
      const sessions = await db.dbGetAllSessions()
      for (const s of sessions) {
        if (s.status === 'banned') continue
        const session = new Session(s.phone_number, s.proxy_string, this)
        session.id = s.id
        this.sessions.set(s.phone_number, session)

        // ── Auto-start logic ──────────────────────────────────────────────
        // Start if:
        //   a) DB says 'online' (was connected before restart), OR
        //   b) Has saved credentials on disk (creds.json exists → can connect without QR)
        // This fixes the bug where network drop → status='offline' in DB → PM2 restarts → session lost
        const sessionDir = db.getSessionDir ? db.getSessionDir(s.phone_number) : null
        const fs = (await import('fs')).default
        const path = (await import('path')).default
        const credsDir = path.resolve(process.env.SESSIONS_DIR || './sessions', s.phone_number.replace(/\+/g, ''))
        const hasCreds = fs.existsSync(path.join(credsDir, 'creds.json'))

        if (s.status === 'online' || hasCreds) {
          session.start()
          autoConnected++
        } else {
          offline++
        }
      }
      this.log(null, `Загружено ${autoConnected + offline} WA-сессий (${autoConnected} подключаются, ${offline} ожидают QR-кода)`, 'system')
    } catch (err) {
      this.log(null, `Ошибка восстановления WA: ${err.message}`, 'error')
    }

    // Restore Telegram accounts
    await this.restoreTelegramAccounts()
  }

  // ─── Campaign / Queue helpers (WhatsApp) ──────────────────────────────────

  async startCampaign(campaignId) {
    const campaign = (await db.dbGetAllCampaigns()).find(c => c.id === campaignId)
    if (!campaign) throw new Error('Кампания не найдена')
    const leads = await db.dbGetPendingLeads(campaignId)
    if (leads.length === 0) throw new Error('Нет ожидающих лидов для этой кампании')

    // ── Round-robin distribution across online sessions ──────────────────
    let onlineSessions = []
    if (campaign.session_id) {
      // Campaign tied to specific session
      const s = (await db.dbGetAllSessions()).find(s => s.id === campaign.session_id)
      if (s) onlineSessions = [s.phone_number]
    }
    if (onlineSessions.length === 0) {
      // Use ALL online sessions for max throughput
      onlineSessions = this.getAllSessionStates()
        .filter(s => s.status === 'online')
        .map(s => s.phone)
    }
    if (onlineSessions.length === 0) throw new Error('Нет онлайн-сессий для запуска кампании')

    // Distribute leads across sessions in round-robin fashion
    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i]
      const sessionPhone = onlineSessions[i % onlineSessions.length]
      this.queue.add({
        id: lead.id, phone: lead.phone, campaignId,
        template: campaign.template_text, sessionPhone,
        delayMinSec: campaign.delay_min_sec, delayMaxSec: campaign.delay_max_sec,
      })
    }

    await db.dbUpdateCampaign(campaignId, { status: 'running' })
    this.queue.start()

    const perSession = Math.ceil(leads.length / onlineSessions.length)
    this.log(null, `Кампания "${campaign.name}" запущена — ${leads.length} лидов на ${onlineSessions.length} сессий (~${perSession}/сессию)`)
    this.broadcast({ type: 'campaign_update', campaignId, status: 'running' })
  }

  async pauseCampaign(campaignId) {
    await db.dbUpdateCampaign(campaignId, { status: 'paused' })
    this.queue.pause()
    this.broadcast({ type: 'campaign_update', campaignId, status: 'paused' })
  }

  async stopCampaign(campaignId) {
    await db.dbUpdateCampaign(campaignId, { status: 'stopped' })
    this.queue.stop()
    this.queue.clear()
    this.broadcast({ type: 'campaign_update', campaignId, status: 'stopped' })
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Telegram Account management
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Create a new Telegram account entry — persist to DB, create in-memory session.
   * Does NOT start auth — user must call requestCode separately.
   */
  async createTelegramAccount(phone) {
    // Check for duplicate phones
    for (const acc of this.telegramAccounts.values()) {
      if (acc.phone === phone) {
        throw new Error('Аккаунт с таким номером уже существует')
      }
    }

    // Persist to DB
    const dbRow = await db.dbCreateTelegramAccount(phone)

    // Create in-memory session
    const session = new TelegramSession(dbRow.id, phone, this)
    this.telegramAccounts.set(dbRow.id, session)

    this.log(phone, `Аккаунт добавлен — запросите код`, 'info', 'telegram')
    this.broadcast({ type: 'tg_account_created', accountId: dbRow.id })

    return {
      id: dbRow.id,
      phone,
      status: 'disconnected',
      created_at: dbRow.created_at,
    }
  }

  /**
   * Request verification code for a Telegram account.
   */
  async requestTelegramCode(accountId) {
    const session = this.telegramAccounts.get(accountId)
    if (!session) throw new Error('Аккаунт не найден')
    return session.requestCode()
  }

  /**
   * Verify the code received on the phone.
   */
  async verifyTelegramCode(accountId, code) {
    const session = this.telegramAccounts.get(accountId)
    if (!session) throw new Error('Аккаунт не найден')
    return session.verifyCode(code)
  }

  /**
   * Verify 2FA password.
   */
  async verifyTelegramPassword(accountId, password) {
    const session = this.telegramAccounts.get(accountId)
    if (!session) throw new Error('Аккаунт не найден')
    return session.verifyPassword(password)
  }

  /**
   * Reconnect an existing account (uses saved session string).
   */
  async connectTelegramAccount(accountId) {
    const session = this.telegramAccounts.get(accountId)
    if (!session) throw new Error('Аккаунт не найден')
    if (session.status === 'active') throw new Error('Аккаунт уже подключён')
    return session.connect()
  }

  /**
   * Disconnect a Telegram account.
   */
  async disconnectTelegramAccount(accountId) {
    const session = this.telegramAccounts.get(accountId)
    if (!session) throw new Error('Аккаунт не найден')
    await session.disconnect()
    return { id: accountId, status: 'disconnected' }
  }

  /**
   * Delete a Telegram account.
   */
  async deleteTelegramAccount(accountId) {
    const session = this.telegramAccounts.get(accountId)
    if (session) {
      try { await session.disconnect() } catch (_) {}
      this.telegramAccounts.delete(accountId)
    }
    await db.dbDeleteTelegramAccount(accountId)
    this.log(null, `Аккаунт ${accountId} удалён`, 'info', 'telegram')
    this.broadcast({ type: 'tg_account_deleted', accountId })
  }

  /**
   * Get all Telegram account states for API response.
   */
  getAllTelegramAccountStates() {
    return Array.from(this.telegramAccounts.values()).map(s => s.getState())
  }

  /**
   * Restore Telegram accounts from DB on startup.
   */
  async restoreTelegramAccounts() {
    try {
      const accounts = await db.dbGetAllTelegramAccounts()
      let restored = 0
      let autoStarted = 0

      for (const a of accounts) {
        const session = new TelegramSession(a.id, a.phone, this, a.session_string || '')
        if (a.username) {
          session.username = a.username
          session.firstName = a.first_name
          session.lastName = a.last_name
        }
        this.telegramAccounts.set(a.id, session)
        restored++

        // Auto-reconnect accounts that were active and have session string
        if (a.status === 'active' && a.session_string) {
          session.connect().catch(err => {
            this.log(a.phone, `Ошибка автоподключения: ${err.message}`, 'error', 'telegram')
          })
          autoStarted++
        }
      }

      if (restored > 0) {
        this.log(null, `Загружено ${restored} TG-аккаунтов (${autoStarted} переподключаются)`, 'system', 'telegram')
      }
    } catch (err) {
      // Silently skip if tables don't exist yet
      if (err.message?.includes('does not exist') || err.code === '42P01') return
      this.log(null, `Ошибка восстановления TG: ${err.message}`, 'error', 'telegram')
    }
  }

  // ─── Telegram Campaign / Queue helpers ────────────────────────────────────

  async startTelegramCampaign(campaignId) {
    const campaign = (await db.dbGetAllTelegramCampaigns()).find(c => c.id === campaignId)
    if (!campaign) throw new Error('Кампания не найдена')

    const leads = await db.dbGetPendingTelegramLeads(campaignId)
    if (leads.length === 0) throw new Error('Нет ожидающих лидов для этой кампании')

    // Find the assigned account or use the first active one
    let accountId = campaign.account_id
    if (accountId) {
      const acc = this.telegramAccounts.get(accountId)
      if (!acc || acc.status !== 'active') throw new Error('Назначенный аккаунт не активен')
    } else {
      const activeAcc = Array.from(this.telegramAccounts.values()).find(a => a.status === 'active')
      if (!activeAcc) throw new Error('Нет активных аккаунтов')
      accountId = activeAcc.id
    }

    for (const lead of leads) {
      this.telegramQueue.add({
        id: lead.id,
        phone: lead.chat_id,
        campaignId,
        template: campaign.template_text,
        sessionPhone: accountId,
        delayMinSec: campaign.delay_min_sec,
        delayMaxSec: campaign.delay_max_sec,
        platform: 'telegram',
      })
    }

    await db.dbUpdateTelegramCampaign(campaignId, { status: 'running' })
    this.telegramQueue.start()

    const accLabel = this.telegramAccounts.get(accountId)?.username || accountId
    this.log(`@${accLabel}`, `TG-кампания "${campaign.name}" запущена — ${leads.length} лидов`, 'info', 'telegram')
    this.broadcast({ type: 'tg_campaign_update', campaignId, status: 'running' })
  }

  async pauseTelegramCampaign(campaignId) {
    await db.dbUpdateTelegramCampaign(campaignId, { status: 'paused' })
    this.telegramQueue.pause()
    this.broadcast({ type: 'tg_campaign_update', campaignId, status: 'paused' })
  }

  async stopTelegramCampaign(campaignId) {
    await db.dbUpdateTelegramCampaign(campaignId, { status: 'stopped' })
    this.telegramQueue.stop()
    this.telegramQueue.clear()
    this.broadcast({ type: 'tg_campaign_update', campaignId, status: 'stopped' })
  }
}

// Singleton
export const orchestrator = new Orchestrator()
