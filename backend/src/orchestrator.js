import { Session } from './session.js'
import { TelegramSession } from './telegram-session.js'
import { MessageQueue } from './queue.js'
import { classifyLead } from './ai-classifier.js'
import { generateAutoReply, extractConversationData } from './ai-responder.js'
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

    /** @type {Map<string, MessageQueue>} sessionPhone → WhatsApp queue (parallel per session) */
    this.waQueues = new Map()

    /** @type {MessageQueue} Telegram queue (separate instance) */
    this.telegramQueue = new MessageQueue(this, 'telegram')

    /** @type {Set<import('ws').WebSocket>} */
    this.wsClients = new Set()

    /** @type {typeof db} */
    this.db = db

    /** In-memory log ring buffer (last 500 entries) */
    this.logBuffer = []
    this.LOG_LIMIT = 500

    /** Daily send limit per session — { sessionPhone: { count, day } } */
    this._dailySent = new Map()
    this.DAILY_LIMIT = 30

    /** Global LID → Phone map (WhatsApp Linked Devices resolution) */
    this._lidMap = new Map()

    /** Per-phone reply lock — prevents concurrent AI replies to same contact */
    this._replyInProgress = new Set()

    /** Flag to prevent overlapping retry scans */
    this._retryRunning = false

    /** Timestamp of last outbound AI message per phone — cooldown tracking */
    this._lastAiReplyTime = new Map()
  }

  // ─── Per-session WhatsApp queues ───────────────────────────────────────────

  /** Aggregated queue status across all WA queues */
  get waQueueStatus() {
    for (const q of this.waQueues.values()) {
      if (q.status === 'running') return 'running'
    }
    for (const q of this.waQueues.values()) {
      if (q.status === 'paused') return 'paused'
    }
    return 'stopped'
  }

  /** Aggregated queue size across all WA queues */
  get waQueueSize() {
    let total = 0
    for (const q of this.waQueues.values()) total += q.size
    return total
  }

  /** Backward-compat getter for .queue property (routes use orchestrator.queue.status/size) */
  get queue() {
    return { status: this.waQueueStatus, size: this.waQueueSize }
  }

  /** Get or create a per-session queue */
  _getOrCreateWaQueue(sessionPhone) {
    if (!this.waQueues.has(sessionPhone)) {
      this.waQueues.set(sessionPhone, new MessageQueue(this))
    }
    return this.waQueues.get(sessionPhone)
  }

  // ─── Daily send limit ──────────────────────────────────────────────────────

  _getDailyCount(sessionPhone) {
    const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
    const entry = this._dailySent.get(sessionPhone)
    if (!entry || entry.day !== today) return 0
    return entry.count
  }

  _incrementDailyCount(sessionPhone) {
    const today = new Date().toISOString().slice(0, 10)
    const entry = this._dailySent.get(sessionPhone)
    if (!entry || entry.day !== today) {
      this._dailySent.set(sessionPhone, { count: 1, day: today })
    } else {
      entry.count++
    }
  }

  canSend(sessionPhone) {
    return this._getDailyCount(sessionPhone) < this.DAILY_LIMIT
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
    // Also output to stdout so PM2 logs capture it
    const prefix = session ? `[${session}]` : '[SYSTEM]'
    const lvl = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : 'ℹ️'
    console.log(`${lvl} ${prefix} ${message}`)
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

  async handleReply(fromPhone, text, sessionPhone, unresolvedLid = null) {
    let leadId = null
    let lead = null
    let resolvedPhone = fromPhone

    try {
      // ── LID Resolution ──────────────────────────────────────────────────
      // WhatsApp Linked Devices use internal LID numbers (e.g. 197882716151908)
      // instead of real phone numbers. We need to resolve LID → phone to:
      // 1) Match the lead in our database
      // 2) Store messages under the correct phone for CRM
      // 3) Send AI auto-replies to the correct JID
      if (unresolvedLid) {
        const resolved = await this._resolveLid(unresolvedLid, sessionPhone)
        if (resolved) {
          resolvedPhone = resolved
          this.log(sessionPhone, `🔗 LID resolved: ${unresolvedLid} → ${resolved}`)
          // Migrate existing messages from LID to real phone
          try { await db.dbMigrateLidMessages(unresolvedLid, resolved) } catch (_) {}
        } else {
          this.log(sessionPhone, `⚠ LID unresolved: ${unresolvedLid} — DB fallback failed`, 'warn')
        }
      }

      // Search both 'sent' and 'replied' leads — so AI auto-reply works
      // for the entire conversation, not just the first reply
      lead = await db.dbFindLeadByPhone(resolvedPhone)
      if (lead) {
        leadId = lead.id
        // Mark as replied only if currently 'sent' (first reply)
        if (lead.status === 'sent') {
          await db.dbMarkLeadReplied(lead.id)
        }
        // Trigger AI classification on first reply
        if (text && lead.status === 'sent') {
          this._classifyLead(lead, text, sessionPhone)
        }
      }
    } catch (err) {
      this.log(sessionPhone, `handleReply ошибка: ${err.message}`, 'error')
    }

    // Store inbound message for CRM — use resolved phone
    if (text) {
      await this.storeMessage(sessionPhone, resolvedPhone, 'inbound', text, null, leadId)
    }
    this.broadcast({ type: 'reply_received', phone: resolvedPhone })

    // ── AI auto-reply: continue the conversation ──────────────────────────
    if (lead && text) {
      this._autoReply(resolvedPhone, sessionPhone, lead).catch(err => {
        this.log(sessionPhone, `AI авто-ответ ошибка: ${err.message}`, 'error')
      })
    }
  }

  // ─── LID Resolution ────────────────────────────────────────────────────────

  /**
   * Resolve a WhatsApp LID (Linked ID) number to a real phone number.
   * Uses multiple strategies:
   * 1. In-memory global cache
   * 2. Session's Baileys contact map
   * 3. DB-based: find outbound phones from same session that haven't received inbound yet
   */
  async _resolveLid(lid, sessionPhone) {
    // Strategy 1: Global in-memory cache
    if (this._lidMap.has(lid)) {
      return this._lidMap.get(lid)
    }

    // Strategy 2: Session's Baileys contact-derived map
    const session = this.sessions.get(sessionPhone)
    if (session?._lidToPhone?.has(lid)) {
      const resolved = session._lidToPhone.get(lid)
      this._lidMap.set(lid, resolved)
      return resolved
    }

    // Strategy 3: DB-based — find phones we sent outbound to from this session
    // that don't have any inbound messages yet (their reply came as LID)
    try {
      const resolved = await db.dbResolveLidByOutbound(sessionPhone, lid)
      if (resolved) {
        this._lidMap.set(lid, resolved)
        if (session) session._lidToPhone.set(lid, resolved)
        return resolved
      }
    } catch (err) {
      this.log(sessionPhone, `LID DB resolution error: ${err.message}`, 'error')
    }

    return null
  }

  /**
   * AI auto-reply — generates and sends a follow-up question.
   * Only fires if the campaign is running or paused (not stopped).
   */
  async _autoReply(remotePhone, sessionPhone, lead) {
    // ── Per-phone lock — prevent concurrent/duplicate AI replies ──────────
    const phoneKey = remotePhone.replace(/\D/g, '')
    if (this._replyInProgress.has(phoneKey)) {
      this.log(sessionPhone, `🤖 AI: ${phoneKey} — уже генерируется ответ, пропуск`, 'warn')
      return
    }

    // ── Cooldown — don't send if we replied less than 60s ago ─────────────
    const lastReply = this._lastAiReplyTime.get(phoneKey)
    if (lastReply && Date.now() - lastReply < 60_000) {
      this.log(sessionPhone, `🤖 AI: ${phoneKey} — кулдаун (ответили ${Math.round((Date.now() - lastReply) / 1000)}с назад)`, 'warn')
      return
    }

    this._replyInProgress.add(phoneKey)
    try {
      // Check campaign status — only auto-reply if campaign is active
      const campaigns = await db.dbGetAllCampaigns()
      const campaign = campaigns.find(c => c.id === lead.campaign_id)
      if (!campaign) return
      if (campaign.status === 'stopped') return  // respect stop

      // Get full conversation history
      const messages = await db.dbGetConversationMessages(remotePhone, 100)
      if (!messages || messages.length < 2) return  // need at least our msg + their reply

      // Generate next question
      const nextMsg = await generateAutoReply(messages)
      if (!nextMsg) {
        // AI says conversation is done — extract final data
        this.log(sessionPhone, `🤖 AI: ${remotePhone} — разговор завершён, извлекаю данные...`)
        const extracted = await extractConversationData(messages)
        if (extracted && lead.id) {
          await db.dbUpdateLeadAI(lead.id, {
            ai_score: extracted.sentiment === 'positive' ? 'hot' : 'warm',
            ai_reason: JSON.stringify(extracted),
          })
          this.log(sessionPhone, `📊 Данные: ${JSON.stringify(extracted).substring(0, 120)}...`)
          this.broadcast({
            type: 'ai_data_extracted',
            leadId: lead.id, phone: lead.phone,
            data: extracted,
          })
        }
        return
      }

      // ── Daily limit check ────────────────────────────────────────────
      if (!this.canSend(sessionPhone)) {
        this.log(sessionPhone, `🤖 AI → ${remotePhone}: дневной лимит ${this.DAILY_LIMIT} сообщений достигнут`, 'warn')
        return
      }

      // Find the session
      const session = this.sessions.get(sessionPhone)
      if (!session || session.status !== 'online') {
        this.log(sessionPhone, `🤖 AI: сессия офлайн, ответ не отправлен`, 'warn')
        return
      }

      // ── Respond immediately: "read" + start typing ──────────────────
      const bareJid = `${remotePhone.replace(/\D/g, '')}@s.whatsapp.net`

      // Small "read" pause (1-3 sec) before typing starts
      const readPause = 1_000 + Math.floor(Math.random() * 2_000)
      await new Promise(r => setTimeout(r, readPause))

      // Show "typing..." indicator
      try { await session.sock.sendPresenceUpdate('composing', bareJid) } catch (_) {}

      // Typing duration — proportional to message length (3–10 sec)
      const typingMs = 3_000 + Math.min(nextMsg.length * 100, 7_000)
      await new Promise(r => setTimeout(r, typingMs))

      try { await session.sock.sendPresenceUpdate('paused', bareJid) } catch (_) {}

      // Send the message directly (bypass sendMessage's own typing)
      const result = await session.sock.sendMessage(bareJid, { text: nextMsg })
      void result
      this._incrementDailyCount(sessionPhone)
      this._lastAiReplyTime.set(phoneKey, Date.now())
      await this.storeMessage(sessionPhone, remotePhone, 'outbound', nextMsg, null, lead.id)

      const dailyLeft = this.DAILY_LIMIT - this._getDailyCount(sessionPhone)
      this.log(sessionPhone, `🤖 AI → ${remotePhone}: "${nextMsg.substring(0, 60)}${nextMsg.length > 60 ? '...' : ''}" [осталось ${dailyLeft}/${this.DAILY_LIMIT}]`)
      this.broadcast({
        type: 'ai_auto_reply',
        sessionPhone, remotePhone,
        message: nextMsg,
      })

      // After every 3rd auto-reply, extract partial data
      const ourFollowups = messages.filter(m => m.direction === 'outbound').length
      if (ourFollowups >= 3 && ourFollowups % 2 === 0) {
        const allMsgs = await db.dbGetConversationMessages(remotePhone, 100)
        const extracted = await extractConversationData(allMsgs)
        if (extracted && lead.id) {
          await db.dbUpdateLeadAI(lead.id, {
            ai_score: extracted.sentiment === 'positive' ? 'hot' : (extracted.sentiment === 'neutral' ? 'warm' : 'cold'),
            ai_reason: JSON.stringify(extracted),
          })
          this.broadcast({
            type: 'ai_data_extracted',
            leadId: lead.id, phone: lead.phone,
            data: extracted,
          })
        }
      }
    } catch (err) {
      this.log(sessionPhone, `🤖 AI ошибка: ${err.message}`, 'error')
    } finally {
      // Always release the lock
      this._replyInProgress.delete(phoneKey)
    }
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

  // ─── Retry missed auto-replies ───────────────────────────────────────────

  /**
   * Scan for conversations where leads replied but we haven't sent an AI follow-up.
   * This catches cases where:
   * - LID resolution wasn't available at the time of reply
   * - PM2 restarted before AI could process
   * - Any transient error prevented auto-reply
   */
  async _retryMissedAutoReplies() {
    // Prevent overlapping retry scans
    if (this._retryRunning) return
    this._retryRunning = true

    try {
      const leads = await db.dbGetRepliedLeads()
      if (leads.length === 0) return

      let retried = 0
      for (const lead of leads) {
        try {
          const phone = lead.phone.replace(/\D/g, '')

          // Skip if reply already in progress for this phone
          if (this._replyInProgress.has(phone)) continue

          // Skip if we replied recently (cooldown)
          const lastReply = this._lastAiReplyTime.get(phone)
          if (lastReply && Date.now() - lastReply < 60_000) continue

          // Get conversation messages
          const messages = await db.dbGetConversationMessages(phone, 100)
          if (!messages || messages.length < 2) continue

          // Check: is the last message inbound? (meaning we haven't replied yet)
          const lastMsg = messages[messages.length - 1]
          if (lastMsg.direction !== 'inbound') continue  // already followed up

          // Check for duplicate spam: if we sent same message 3+ times, skip (already damaged)
          const ourMsgs = messages.filter(m => m.direction === 'outbound')
          const msgCounts = new Map()
          for (const m of ourMsgs) {
            const key = m.body?.toLowerCase().trim()
            if (key) msgCounts.set(key, (msgCounts.get(key) || 0) + 1)
          }
          let hasDupes = false
          for (const count of msgCounts.values()) {
            if (count >= 3) { hasDupes = true; break }
          }
          if (hasDupes) {
            // Conversation is damaged by spam — extract data and stop
            this.log(null, `🔄 ${phone}: обнаружены дубликаты, извлекаю данные без продолжения`)
            const extracted = await extractConversationData(messages)
            if (extracted && lead.id) {
              await db.dbUpdateLeadAI(lead.id, {
                ai_score: extracted.sentiment === 'positive' ? 'hot' : 'warm',
                ai_reason: JSON.stringify(extracted),
              })
            }
            continue
          }

          // Find which session sent to this lead
          const lastOutbound = await db.dbGetLastOutboundMessage(phone)
          if (!lastOutbound) continue
          const sessionPhone = lastOutbound.session_phone

          // Check if session is online — try fallback if assigned session offline
          let session = this.sessions.get(sessionPhone)
          let actualSessionPhone = sessionPhone
          if (!session || session.status !== 'online') {
            // Fallback to any online session
            for (const [ph, s] of this.sessions) {
              if (s.status === 'online' && this.canSend(ph)) {
                session = s
                actualSessionPhone = ph
                break
              }
            }
            if (!session || session.status !== 'online') continue
          }

          // Check daily limit
          if (!this.canSend(actualSessionPhone)) continue

          this.log(actualSessionPhone, `🔄 Пропущенный AI-ответ для ${phone} — отправляю`)
          await this._autoReply(phone, actualSessionPhone, lead)
          retried++

          // Longer delay between retries to prevent spam (15s)
          await new Promise(r => setTimeout(r, 15_000))
        } catch (err) {
          this.log(null, `🔄 Ошибка retry для ${lead.phone}: ${err.message}`, 'error')
        }
      }

      if (retried > 0) {
        this.log(null, `🔄 Отправлено ${retried} пропущенных AI-ответов`)
      }
    } catch (err) {
      this.log(null, `🔄 _retryMissedAutoReplies ошибка: ${err.message}`, 'error')
    } finally {
      this._retryRunning = false
    }
  }

  async restoreFromDB() {
    // ── Load persistent LID → Phone mappings ────────────────────────────
    try {
      const saved = await db.dbLoadLidMappings()
      if (saved.size > 0) {
        for (const [lid, phone] of saved) {
          this._lidMap.set(lid, phone)
        }
        this.log(null, `🔗 Загружено ${saved.size} LID→Phone маппингов из БД`)
      }
    } catch (_) {}

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
        // Only auto-reconnect sessions that were ONLINE in DB (user had them connected).
        // Sessions that were offline/disconnected stay offline until user clicks Connect.
        // NOTE: temporary disconnects (428, timeout) do NOT write 'offline' to DB,
        // so sessions that dropped due to network issues will auto-reconnect correctly.
        if (s.status === 'online') {
          // ── Стаггеринг: запускаем сессии с интервалом 15-30с друг от друга ──
          // Чтобы WhatsApp не видел 3-4 одновременных подключения → меньше банов
          const staggerDelay = autoConnected * (15_000 + Math.floor(Math.random() * 15_000))
          if (staggerDelay === 0) {
            session.start()
          } else {
            setTimeout(() => session.start(), staggerDelay)
            this.log(s.phone_number, `Отложенный старт через ${Math.round(staggerDelay / 1000)}с (стаггеринг)`)
          }
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

    // ── Auto-resume running campaigns after restart ─────────────────────
    // Wait for sessions to connect, then re-load pending leads into queue
    const RESUME_DELAY = 45_000 // 45 sec — enough for sessions to reconnect
    setTimeout(() => this._resumeRunningCampaigns(), RESUME_DELAY)

    // ── Retry missed auto-replies ──────────────────────────────────────
    // 60 sec after startup: catch conversations where AI didn't reply
    setTimeout(() => this._retryMissedAutoReplies(), 60_000)
    // Then check every 3 minutes
    setInterval(() => this._retryMissedAutoReplies(), 3 * 60_000)
  }

  /**
   * After PM2 restart, re-populate the queue for any campaign with status='running'.
   * This fixes the "queue empty after restart" bug.
   */
  async _resumeRunningCampaigns() {
    try {
      const campaigns = await db.dbGetAllCampaigns()
      for (const campaign of campaigns) {
        if (campaign.status !== 'running') continue

        const leads = await db.dbGetPendingLeads(campaign.id)
        if (leads.length === 0) {
          this.log(null, `Кампания "${campaign.name}" running, но нет pending лидов — пропускаю`)
          continue
        }

        // Find online sessions
        let onlineSessions = this.getAllSessionStates()
          .filter(s => s.status === 'online')
          .map(s => s.phone)

        if (onlineSessions.length === 0) {
          this.log(null, `Кампания "${campaign.name}": нет онлайн-сессий для возобновления`, 'warn')
          continue
        }

        // Round-robin into per-session queues (parallel sending)
        for (let i = 0; i < leads.length; i++) {
          const lead = leads[i]
          const sessionPhone = onlineSessions[i % onlineSessions.length]
          const queue = this._getOrCreateWaQueue(sessionPhone)
          queue.add({
            id: lead.id, phone: lead.phone, campaignId: campaign.id,
            template: campaign.template_text, sessionPhone,
            delayMinSec: campaign.delay_min_sec, delayMaxSec: campaign.delay_max_sec,
          })
        }

        // Start all session queues in parallel
        for (const q of this.waQueues.values()) q.start()
        const perSession = Math.ceil(leads.length / onlineSessions.length)
        this.log(null, `♻ Кампания "${campaign.name}" возобновлена — ${leads.length} лидов на ${onlineSessions.length} сессий (~${perSession}/сессию) [ПАРАЛЛЕЛЬНО]`)
      }
    } catch (err) {
      this.log(null, `Ошибка возобновления кампаний: ${err.message}`, 'error')
    }
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

    // Distribute leads across per-session queues (parallel sending)
    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i]
      const sessionPhone = onlineSessions[i % onlineSessions.length]
      const queue = this._getOrCreateWaQueue(sessionPhone)
      queue.add({
        id: lead.id, phone: lead.phone, campaignId,
        template: campaign.template_text, sessionPhone,
        delayMinSec: campaign.delay_min_sec, delayMaxSec: campaign.delay_max_sec,
      })
    }

    await db.dbUpdateCampaign(campaignId, { status: 'running' })
    // Start all session queues in parallel
    for (const q of this.waQueues.values()) q.start()

    const perSession = Math.ceil(leads.length / onlineSessions.length)
    this.log(null, `🚀 Кампания "${campaign.name}" запущена — ${leads.length} лидов на ${onlineSessions.length} сессий (~${perSession}/сессию) [ПАРАЛЛЕЛЬНО]`)
    this.broadcast({ type: 'campaign_update', campaignId, status: 'running' })
  }

  async pauseCampaign(campaignId) {
    await db.dbUpdateCampaign(campaignId, { status: 'paused' })
    for (const q of this.waQueues.values()) q.pause()
    this.broadcast({ type: 'campaign_update', campaignId, status: 'paused' })
  }

  async stopCampaign(campaignId) {
    await db.dbUpdateCampaign(campaignId, { status: 'stopped' })
    for (const q of this.waQueues.values()) {
      q.stop()
      q.clear()
    }
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
