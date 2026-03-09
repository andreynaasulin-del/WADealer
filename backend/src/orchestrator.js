import fs from 'fs'
import path from 'path'
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
    this.DAILY_LIMIT = 45

    /** Global LID → Phone map (WhatsApp Linked Devices resolution) */
    this._lidMap = new Map()

    /** Per-phone reply lock — prevents concurrent AI replies to same contact */
    this._replyInProgress = new Set()

    /** AI disabled flag — set to true when OpenAI quota exceeded (429) */
    this._aiDisabled = false
    this._aiDisabledLoggedAt = 0  // timestamp of last "AI disabled" log

    /** Flag to prevent overlapping retry scans */
    this._retryRunning = false

    /** Timestamp of last outbound AI message per phone — cooldown tracking */
    this._lastAiReplyTime = new Map()

    /** Phones where AI decided conversation is complete — don't retry */
    this._aiConversationDone = new Set()
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

  /**
   * Delete a message "for everyone" via Baileys.
   * Requires the wa_message_id and session_phone from wa_messages table.
   */
  async deleteMessage(sessionPhone, remotePhone, waMessageId) {
    if (!waMessageId) throw new Error('Нет wa_message_id — невозможно удалить')
    const session = this.sessions.get(sessionPhone)
    if (!session || session.status !== 'online') throw new Error('Сессия офлайн')
    const bareJid = `${remotePhone.replace(/\D/g, '')}@s.whatsapp.net`
    const deleteKey = { remoteJid: bareJid, fromMe: true, id: waMessageId }
    await session.sock.sendMessage(bareJid, { delete: deleteKey })
    this.log(sessionPhone, `🗑️ Удалено сообщение ${waMessageId} для ${remotePhone}`)
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
    const inboundKey = fromPhone.replace(/\D/g, '')

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
      // Only reset "conversation done" flag for genuinely new messages
      // (prevents Baileys history replay from triggering infinite retries)
      this._aiConversationDone.delete(inboundKey)
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
    // ── AI DISABLED — skip entirely when OpenAI quota exceeded ──────────
    if (this._aiDisabled) {
      // Log only once per 5 minutes to avoid spam
      if (Date.now() - this._aiDisabledLoggedAt > 5 * 60 * 1000) {
        this._aiDisabledLoggedAt = Date.now()
        this.log(sessionPhone, `🤖 AI выключен (OpenAI квота). Оплати баланс и перезапусти.`, 'warn')
      }
      return
    }

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
      // Check campaign exists — AI auto-reply works for ANY campaign status
      // (stopped/paused campaigns still need to follow up replied leads)
      const campaigns = await db.dbGetAllCampaigns()
      const campaign = campaigns.find(c => c.id === lead.campaign_id)
      if (!campaign) return

      // Get full conversation history
      let messages = await db.dbGetConversationMessages(remotePhone, 100)

      // If no stored messages, bootstrap with campaign template + girl's reply
      if (!messages || messages.length < 2) {
        // Find campaign template to create context
        const campaigns = await db.dbGetAllCampaigns()
        const campaign2 = campaigns.find(c => c.id === lead.campaign_id)
        if (!campaign2?.template_text) return

        // Store the original campaign message so future retries have context
        await this.storeMessage(sessionPhone, remotePhone, 'outbound', campaign2.template_text, null, lead.id)

        // If there's at least 1 inbound message, we can proceed
        if (!messages || messages.length === 0) return

        // Re-fetch after storing
        messages = await db.dbGetConversationMessages(remotePhone, 100)
        if (!messages || messages.length < 2) return
      }

      // Generate next question
      const nextMsg = await generateAutoReply(messages)
      if (!nextMsg) {
        // Extract data to see how many fields we have
        const extracted = await extractConversationData(messages)
        if (extracted && lead.id) {
          await db.dbUpdateLeadAI(lead.id, {
            ai_score: extracted.completeness === 'HOT' ? 'hot' : (extracted.completeness === 'WARM' ? 'warm' : 'cold'),
            ai_reason: JSON.stringify(extracted),
          })
          this.broadcast({
            type: 'ai_data_extracted',
            leadId: lead.id, phone: lead.phone,
            data: extracted,
          })

          // Count how many of the 7 essential fields are filled
          const essentials = ['address', 'city', 'price_text', 'nationality', 'incall_outcall', 'independent_or_agency', 'has_photos']
          const filledCount = essentials.filter(f => {
            const v = extracted[f]
            return v && v !== 'null' && v !== null && v !== false && v !== 0
          }).length

          if (filledCount >= 6) {
            // Enough data — mark as done
            this._aiConversationDone.add(phoneKey)
            this.log(sessionPhone, `🤖 AI: ${remotePhone} — данные собраны (${filledCount}/7), завершён`)
            this.log(sessionPhone, `📊 Данные: ${JSON.stringify(extracted).substring(0, 120)}...`)
          } else {
            // Not enough data — DON'T mark as done, let retry pick it up later
            this.log(sessionPhone, `🤖 AI: ${remotePhone} — только ${filledCount}/7 полей, оставляю для повтора`)
          }
        } else {
          // No data extracted at all — don't mark as done
          this.log(sessionPhone, `🤖 AI: ${remotePhone} — нет данных, оставляю для повтора`)
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
      const waMessageId = result?.key?.id || null
      this._incrementDailyCount(sessionPhone)
      this._lastAiReplyTime.set(phoneKey, Date.now())
      await this.storeMessage(sessionPhone, remotePhone, 'outbound', nextMsg, waMessageId, lead.id)

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
      // ── Detect OpenAI 429 quota exceeded — disable AI globally ──────
      if (err.message?.includes('429') || err.status === 429 || err.code === 'rate_limit_exceeded' || err.message?.includes('quota')) {
        this._aiDisabled = true
        this._aiDisabledLoggedAt = Date.now()
        this.log(sessionPhone, `🚫 OpenAI квота исчерпана — AI автоответы ВЫКЛЮЧЕНЫ. Оплати баланс OpenAI и перезапусти сервер.`, 'error')
        this.broadcast({ type: 'ai_disabled', reason: 'OpenAI 429 quota exceeded' })
      } else {
        this.log(sessionPhone, `🤖 AI ошибка: ${err.message}`, 'error')
      }
    } finally {
      // Always release the lock
      this._replyInProgress.delete(phoneKey)
    }
  }

  /** Re-enable AI auto-replies (call after OpenAI balance is topped up) */
  enableAI() {
    this._aiDisabled = false
    this._aiDisabledLoggedAt = 0
    this.log('SYSTEM', '✅ AI автоответы ВКЛЮЧЕНЫ', 'info')
    this.broadcast({ type: 'ai_enabled' })
  }

  async _classifyLead(lead, inboundText, sessionPhone) {
    if (this._aiDisabled) return  // skip when OpenAI quota exceeded
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
      if (err.message?.includes('429') || err.status === 429 || err.message?.includes('quota')) {
        if (!this._aiDisabled) {
          this._aiDisabled = true
          this._aiDisabledLoggedAt = Date.now()
          this.log(sessionPhone, `🚫 OpenAI квота — AI классификация ВЫКЛЮЧЕНА`, 'error')
        }
      } else {
        this.log(sessionPhone, `AI ошибка: ${err.message}`, 'error')
      }
    }
  }

  /**
   * Force-trigger AI follow-up for a specific phone (manual recovery).
   * Cleans duplicate outbound messages from DB first, then triggers AI.
   */
  async forceAiReply(remotePhone) {
    const phone = remotePhone.replace(/\D/g, '')

    // Reset conversation-done flag
    this._aiConversationDone.delete(phone)
    this._replyInProgress.delete(phone)
    this._lastAiReplyTime.delete(phone)

    // Clean duplicate outbound messages from DB (keep first occurrence only)
    try {
      const messages = await db.dbGetConversationMessages(phone, 200)
      const outbound = messages.filter(m => m.direction === 'outbound')
      const seen = new Map() // body → first message id
      const dupeIds = []
      for (const m of outbound) {
        const key = m.body?.toLowerCase().trim()
        if (!key) continue
        if (seen.has(key)) {
          dupeIds.push(m.id)
        } else {
          seen.set(key, m.id)
        }
      }
      if (dupeIds.length > 0) {
        for (const id of dupeIds) {
          await db.dbDeleteMessage(id)
        }
        this.log(null, `🧹 ${phone}: удалено ${dupeIds.length} дубликатов из БД`)
      }
    } catch (err) {
      this.log(null, `forceAiReply cleanup error: ${err.message}`, 'error')
    }

    // Find lead
    const lead = await db.dbFindLeadByPhone(phone)
    if (!lead) throw new Error(`Лид не найден для ${phone}`)

    // Find online session
    let sessionPhone = null
    const lastOutbound = await db.dbGetLastOutboundMessage(phone)
    if (lastOutbound) sessionPhone = lastOutbound.session_phone
    const session = this.sessions.get(sessionPhone)
    if (!session || session.status !== 'online') {
      // Fallback to any online session
      for (const [ph, s] of this.sessions) {
        if (s.status === 'online' && this.canSend(ph)) { sessionPhone = ph; break }
      }
    }
    if (!sessionPhone) throw new Error('Нет онлайн сессий')

    this.log(sessionPhone, `🔧 Принудительный AI-ответ для ${phone}`)
    await this._autoReply(phone, sessionPhone, lead)
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

      // Stats for this cycle
      let retried = 0
      let skippedDone = 0, skippedCooldown = 0, skippedNoMsgs = 0, skippedOutbound = 0, skippedDupes = 0, skippedNoSession = 0, processed = 0
      for (const lead of leads) {
        try {
          const phone = lead.phone.replace(/\D/g, '')

          // Skip if AI already decided this conversation is complete
          if (this._aiConversationDone.has(phone)) { skippedDone++; continue }

          // Skip if reply already in progress for this phone
          if (this._replyInProgress.has(phone)) continue

          // Skip if we replied recently (cooldown)
          const lastReply = this._lastAiReplyTime.get(phone)
          if (lastReply && Date.now() - lastReply < 60_000) { skippedCooldown++; continue }

          // Get conversation messages
          let messages = await db.dbGetConversationMessages(phone, 100)
          if (!messages) messages = []

          // If missing outbound (campaign sent before message storage), bootstrap
          if (messages.length < 2) {
            const hasInbound = messages.some(m => m.direction === 'inbound')
            const hasOutbound = messages.some(m => m.direction === 'outbound')
            if (!hasOutbound) {
              // Store original campaign message to create context
              const campaigns = await db.dbGetAllCampaigns()
              const camp = campaigns.find(c => c.id === lead.campaign_id)
              if (camp?.template_text) {
                await this.storeMessage(null, phone, 'outbound', camp.template_text, null, lead.id)
                messages = await db.dbGetConversationMessages(phone, 100)
              }
            }
            if (!messages || messages.length < 2) { skippedNoMsgs++; continue }
          }

          // Check last message direction
          const lastMsg = messages[messages.length - 1]
          if (lastMsg.direction !== 'inbound') {
            // Our outbound is last — check if it's "stale" (sent 4+ hours ago, girl didn't reply)
            const lastTime = new Date(lastMsg.created_at).getTime()
            const hoursSince = (Date.now() - lastTime) / (1000 * 60 * 60)
            if (hoursSince < 4) { skippedOutbound++; continue }  // too recent, wait for girl to reply
            // Stale conversation — send ONE more follow-up nudge
            // But limit to max 2 stale follow-ups per conversation
            const outboundAfterLastInbound = []
            for (let i = messages.length - 1; i >= 0; i--) {
              if (messages[i].direction === 'outbound') outboundAfterLastInbound.push(messages[i])
              else break
            }
            if (outboundAfterLastInbound.length >= 3) { skippedOutbound++; continue }  // already nudged enough, give up
          }

          // Check for duplicate spam: if we sent same message 2+ times, skip (already damaged)
          const ourMsgs = messages.filter(m => m.direction === 'outbound')
          const msgCounts = new Map()
          for (const m of ourMsgs) {
            const key = m.body?.toLowerCase().trim()
            if (key) msgCounts.set(key, (msgCounts.get(key) || 0) + 1)
          }
          let hasDupes = false
          for (const count of msgCounts.values()) {
            if (count >= 2) { hasDupes = true; break }
          }
          if (hasDupes) {
            skippedDupes++
            // Conversation is damaged by spam — extract data and mark done
            this._aiConversationDone.add(phone)
            const extracted = await extractConversationData(messages)
            if (extracted && lead.id) {
              await db.dbUpdateLeadAI(lead.id, {
                ai_score: extracted.sentiment === 'positive' ? 'hot' : 'warm',
                ai_reason: JSON.stringify(extracted),
              })
            }
            continue
          }

          // Find which session sent to this lead (or any online session if no outbound stored)
          const lastOutbound = await db.dbGetLastOutboundMessage(phone)
          let sessionPhone = lastOutbound?.session_phone || null
          let session = sessionPhone ? this.sessions.get(sessionPhone) : null
          let actualSessionPhone = sessionPhone

          // If no session found or session offline → use any online session
          if (!session || session.status !== 'online' || !this.canSend(actualSessionPhone)) {
            session = null
            actualSessionPhone = null
            for (const [ph, s] of this.sessions) {
              if (s.status === 'online' && this.canSend(ph)) {
                session = s
                actualSessionPhone = ph
                break
              }
            }
            if (!session || !actualSessionPhone) { skippedNoSession++; continue }
          }

          // Check daily limit
          if (!this.canSend(actualSessionPhone)) { skippedNoSession++; continue }

          // Call autoReply — it will check dupes/cooldown/done internally
          processed++
          await this._autoReply(phone, actualSessionPhone, lead)

          // If AI just marked it as done, don't count as retry
          if (this._aiConversationDone.has(phone)) continue

          // Check if reply was actually sent (last message is now outbound)
          const msgsAfter = await db.dbGetConversationMessages(phone, 2)
          const lastAfter = msgsAfter?.[msgsAfter.length - 1]
          if (lastAfter?.direction === 'outbound') {
            retried++
            this.log(actualSessionPhone, `🔄 AI-ответ отправлен для ${phone}`)
          }

          // Delay between retries (8s)
          await new Promise(r => setTimeout(r, 8_000))
        } catch (err) {
          this.log(null, `🔄 Ошибка retry для ${lead.phone}: ${err.message}`, 'error')
        }
      }

      // Summary log
      this.log(null, `🔄 Retry: ${leads.length} лидов | sent=${retried} done=${skippedDone} cooldown=${skippedCooldown} outbound=${skippedOutbound} dupes=${skippedDupes} noMsgs=${skippedNoMsgs} noSession=${skippedNoSession}`)
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
        // Auto-reconnect sessions that have credentials on disk.
        // Sessions without credentials stay offline until user links via QR/code.
        const sessionDir = path.resolve(process.env.SESSIONS_DIR || './sessions', s.phone_number.replace(/\+/g, ''))
        const hasCreds = fs.existsSync(path.join(sessionDir, 'creds.json'))

        if (hasCreds && s.status !== 'banned') {
          // ── Стаггеринг: 10-20с между сессиями ──
          const staggerDelay = autoConnected * (10_000 + Math.floor(Math.random() * 10_000))
          if (staggerDelay === 0) {
            session.start()
          } else {
            setTimeout(() => session.start(), staggerDelay)
            this.log(s.phone_number, `Старт через ${Math.round(staggerDelay / 1000)}с (стаггеринг)`)
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
    // Then check every 2 minutes
    setInterval(() => this._retryMissedAutoReplies(), 2 * 60_000)

    // ── SESSION WATCHDOG: бронебойный реконнект ──────────────────────
    // Каждые 2 мин проверяем все сессии. Если должна быть online но отвалилась → реконнект
    this._watchdogTimer = setInterval(() => this._sessionWatchdog(), 2 * 60_000)
    // Первый запуск через 90 сек (дать время на стартовый connect)
    setTimeout(() => this._sessionWatchdog(), 90_000)
  }

  /**
   * Watchdog: проверяет ВСЕ сессии каждые 2 мин.
   * - offline + creds → reconnect
   * - initializing > 3 min → force reconnect
   * - reconnecting без таймера → reconnect
   * - online + dead ws → reconnect
   */
  async _sessionWatchdog() {
    let reconnected = 0
    const now = Date.now()

    for (const [phone, session] of this.sessions) {
      if (session.stopped) continue
      if (session.status === 'banned') continue
      if (session.status === 'qr_pending' || session.status === 'pairing_pending') continue

      // ── Online: проверяем WebSocket state ──
      if (session.status === 'online') {
        try {
          const ws = session.sock?.ws
          if (ws && typeof ws.readyState === 'number' && ws.readyState !== 1) {
            this.log(phone, `🔧 Watchdog: online но WS dead (state=${ws.readyState}), реконнект...`, 'warn')
            session._startLock = false
            session._scheduleReconnect('watchdog_ws_dead', ws.readyState)
            reconnected++
          }
        } catch (_) {}
        continue
      }

      // ── Reconnecting с таймером — не трогаем ──
      if (session.status === 'reconnecting' && session._reconnectTimer) continue

      // ── Initializing > 3 мин — застряла, force reconnect ──
      if (session.status === 'initializing' && session._lastStartAt > 0) {
        const stuckFor = now - session._lastStartAt
        if (stuckFor < 3 * 60_000) continue // дать 3 мин на подключение
        this.log(phone, `🔧 Watchdog: зависла в initializing ${Math.round(stuckFor/1000)}с, force reconnect`, 'warn')
        session._startLock = false
        session._cleanup()
        session._scheduleReconnect('watchdog_stuck', 'initializing')
        reconnected++
        continue
      }

      // ── Offline / reconnecting без таймера — проверяем creds ──
      const sessionDir = path.resolve(process.env.SESSIONS_DIR || './sessions', phone.replace(/\+/g, ''))
      const credsFile = path.join(sessionDir, 'creds.json')
      let hasCreds = false
      try { hasCreds = fs.existsSync(credsFile) } catch (_) {}

      if (!hasCreds) continue

      this.log(phone, `🔧 Watchdog: ${session.status} + creds → авто-реконнект`, 'warn')
      try {
        session.stopped = false
        session._startLock = false
        session.start()
        reconnected++
      } catch (err) {
        this.log(phone, `Watchdog: ошибка — ${err.message}`, 'error')
      }
    }

    if (reconnected > 0) {
      this.log(null, `🔧 Watchdog: переподключено ${reconnected} сессий`, 'system')
    }
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
