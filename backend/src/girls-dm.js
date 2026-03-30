/**
 * Girls DM Engine — mass DM working girls from 19 TG accounts.
 *
 * Each account runs as independent worker with its own timer.
 * Max 25 DMs per account per day, 3-8 min between messages.
 * All 19 accounts work IN PARALLEL = up to 19 DMs every 3-8 min.
 */

import { Api } from 'telegram'
import { NewMessage } from 'telegram/events/index.js'

// ── Warmup schedule: gradual increase of DMs per day ──────────────────────
// Current: 3 DMs per account, 1 hour delay
const WARMUP_SCHEDULE = [
  { days: 3, limit: 7,  delayMin: 20 * 60_000, delayMax: 25 * 60_000 },  // days 1-3: 7 DMs, 20-25 min
  { days: 7, limit: 10, delayMin: 15 * 60_000, delayMax: 20 * 60_000 },  // days 4-7
  { days: 14, limit: 15, delayMin: 10 * 60_000, delayMax: 18 * 60_000 }, // days 8-14
  { days: Infinity, limit: 25, delayMin: 8 * 60_000, delayMax: 15 * 60_000 }, // day 15+
]

function getWarmupConfig(dmStartDate) {
  if (!dmStartDate) return WARMUP_SCHEDULE[0] // no history = day 1
  const daysSinceStart = Math.floor((Date.now() - new Date(dmStartDate).getTime()) / 86400000)
  for (const tier of WARMUP_SCHEDULE) {
    if (daysSinceStart < tier.days) return tier
  }
  return WARMUP_SCHEDULE[WARMUP_SCHEDULE.length - 1]
}

// Auto-reply when a girl responds POSITIVELY
const AUTO_REPLY_HE = `מעולה! 🤍\nהנה הקישור לפרסום החינמי שלך באתר — פשוט לחצי על "Add Profile" ומלאי את הטופס הקצר:\nhttps://tahles.top\n\nGreat! 🤍\nHere's your free listing link — just click "Add Profile" and fill out the short form:\nhttps://tahles.top`

// Message templates — bilingual Hebrew + English
const MESSAGES = [
  (name) => `שלום${name ? ' ' + name : ''}, אני מנהל בצוות Tahles ורוצה להציע לך פרסום מודעה חינמי באתר שלנו — לקוחות פונים אלייך ישירות בוואטסאפ, ללא מתווכים ובלי עמלות. 🤍\nמעניין אותך?\n\nHey${name ? ' ' + name : ''}, I'm a manager at Tahles and I'd like to offer you a free ad listing on our site — clients contact you directly via WhatsApp, no middlemen, no fees. 🤍\nInterested?`,

  (name) => `היי${name ? ' ' + name : ''}, אנחנו מפלטפורמת Tahles ומציעים לך לפרסם את עצמך בחינם. לקוחות פונים אלייך ישירות בוואטסאפ, ללא עמלות ותיווך. 🤍\nרוצה לשמוע עוד?\n\nHi${name ? ' ' + name : ''}, we're from the Tahles platform and we'd love to offer you a free listing. Clients reach you directly on WhatsApp, no commissions or middlemen. 🤍\nWant to hear more?`,

  (name) => `שלום${name ? ' ' + name : ''}, אני מצוות Tahles. יש לנו פלטפורמה שמאפשרת לך לקבל לקוחות ישירות לוואטסאפ — חינם, בלי מתווכים ובלי עמלות. 🤍\nזה מעניין אותך?\n\nHey${name ? ' ' + name : ''}, I'm from the Tahles team. We have a platform that lets you get clients directly to your WhatsApp — free, no middlemen, no fees. 🤍\nInterested?`,

  (name) => `היי${name ? ' ' + name : ''}, הגעתי מצוות Tahles. אנחנו מציעים פרסום חינמי באתר שלנו — לקוחות יפנו אלייך ישירות בוואטסאפ ללא עמלות. 🤍\nרוצה לנסות?\n\nHi${name ? ' ' + name : ''}, I'm reaching out from the Tahles team. We offer free advertising on our site — clients contact you directly via WhatsApp with no fees. 🤍\nWant to try it?`,
]

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function getMessageForGirl(girl) {
  const name = girl.first_name || ''
  const cleanName = name.replace(/[^\w\s\u0590-\u05ff\u0400-\u04ff]/g, '').trim()
  return pick(MESSAGES)(cleanName)
}

export class GirlsDmEngine {
  constructor(orchestrator) {
    this.orchestrator = orchestrator
    this._running = false
    this._workers = new Map() // accountId → timer
    this._dailySent = new Map() // accountId → count
    this._dayStart = null
    this._floodedAccounts = new Set() // accounts hit PEER_FLOOD today
    this._replyHandlers = new Map() // accountId → handler (for cleanup)
    this._repliedUsers = new Set() // user IDs already auto-replied to (avoid spam)
    this._dmStartDates = new Map() // accountId → first DM date (for warmup)
  }

  get isRunning() { return this._running }

  async start() {
    if (this._running) return
    this._running = true
    this._dayStart = new Date().toDateString()
    this._dailySent.clear()
    this._floodedAccounts.clear()

    // Load warmup start dates from DB (first DM date per account)
    try {
      const { data } = await this.orchestrator.db.supabase
        .from('tg_girls')
        .select('dm_sent_by, dm_sent_at')
        .not('dm_sent_by', 'is', null)
        .order('dm_sent_at', { ascending: true })
      for (const row of (data || [])) {
        if (row.dm_sent_by && row.dm_sent_at && !this._dmStartDates.has(row.dm_sent_by)) {
          // Find TG account ID by username
          for (const [id, session] of this.orchestrator.telegramAccounts) {
            if (session.username === row.dm_sent_by) {
              this._dmStartDates.set(id, row.dm_sent_at)
              break
            }
          }
        }
      }
    } catch (e) {
      this.orchestrator.log(null, `📨 Warmup dates load error: ${e.message}`, 'warn')
    }

    this.orchestrator.log(null, '📨 Girls DM кампания запущена (warmup mode)', 'system')

    // Log warmup status per account
    for (const [id, session] of this.orchestrator.telegramAccounts) {
      if (session.status !== 'active') continue
      const warmup = getWarmupConfig(this._dmStartDates.get(id))
      const startDate = this._dmStartDates.get(id)
      const day = startDate ? Math.floor((Date.now() - new Date(startDate).getTime()) / 86400000) + 1 : 0
      this.orchestrator.log(null, `📨 @${session.username}: день ${day}, лимит ${warmup.limit} DM, задержка ${Math.round(warmup.delayMin/60000)}-${Math.round(warmup.delayMax/60000)} мин`, 'system')
    }

    // Start a worker for EACH active account
    this._startAllWorkers()

    // Setup incoming message handlers for auto-reply
    this._setupReplyHandlers()
  }

  stop() {
    this._running = false
    for (const [id, timer] of this._workers) {
      clearTimeout(timer)
    }
    this._workers.clear()
    this._removeReplyHandlers()
    this.orchestrator.log(null, '⏹ Girls DM кампания остановлена', 'system')
  }

  getStats() {
    const stats = {}
    for (const [id, count] of this._dailySent) {
      stats[id] = count
    }
    return {
      running: this._running,
      dailySent: stats,
      activeWorkers: this._workers.size,
      floodedAccounts: this._floodedAccounts.size,
    }
  }

  /**
   * Setup GramJS event handlers on all active accounts to catch incoming DMs.
   * When a girl replies, auto-send the bot link.
   */
  _setupReplyHandlers() {
    for (const [id, session] of this.orchestrator.telegramAccounts) {
      if (session.status !== 'active' || !session.client) continue
      if (this._replyHandlers.has(id)) continue // already set

      const handler = async (event) => {
        try {
          const msg = event.message
          if (!msg || msg.out) return // skip outgoing
          if (!msg.isPrivate) return // only private DMs

          const senderId = msg.senderId ? Number(msg.senderId) : null
          if (!senderId) return

          // Check if this user is in our tg_girls table with status 'sent'
          const girl = await this.orchestrator.db.dbGetGirlByUserId(senderId)
          if (!girl || girl.dm_status !== 'sent') return

          // Don't auto-reply twice
          if (this._repliedUsers.has(senderId)) return
          this._repliedUsers.add(senderId)

          const text = (msg.message || '').trim().toLowerCase()

          // Detect NEGATIVE responses — don't send link, just mark as replied
          const NEGATIVE = ['לא', 'לא מעניין', 'לא תודה', 'no', 'not interested', 'stop', 'spam', 'חסום', 'block', 'לא רלוונטי', 'תפסיק', 'עזוב']
          const isNegative = NEGATIVE.some(n => text.includes(n))

          // Mark as replied in DB
          await this.orchestrator.db.dbUpdateGirlDmStatus(girl.id, 'replied')

          if (isNegative) {
            this.orchestrator.log(null,
              `📨 💬 @${session.username} ← @${girl.username || senderId}: "${text.slice(0,30)}" — תשובה שלילית, לא שולחים קישור`,
              'system'
            )
            return // DON'T send link on negative response
          }

          // Positive/neutral/question — send site link
          await session.client.sendMessage(msg.chatId || senderId, { message: AUTO_REPLY_HE })

          this.orchestrator.log(null,
            `📨 💬 @${session.username} ← @${girl.username || senderId}: "${text.slice(0,30)}" — ✅ ссылка отправлена`,
            'system'
          )
        } catch (err) {
          this.orchestrator.log(null, `📨 Reply handler error: ${err.message}`, 'warn')
        }
      }

      session.client.addEventHandler(handler, new NewMessage({ incoming: true }))
      this._replyHandlers.set(id, handler)
    }

    const count = this._replyHandlers.size
    this.orchestrator.log(null, `📨 Auto-reply handlers установлены на ${count} аккаунтах`, 'system')
  }

  _removeReplyHandlers() {
    for (const [id, handler] of this._replyHandlers) {
      const session = this.orchestrator.telegramAccounts.get(id)
      if (session?.client) {
        try { session.client.removeEventHandler(handler, new NewMessage({ incoming: true })) } catch (_) {}
      }
    }
    this._replyHandlers.clear()
  }

  _startAllWorkers() {
    for (const [id, session] of this.orchestrator.telegramAccounts) {
      if (session.status !== 'active' || !session.client?.connected) continue
      if (this._floodedAccounts.has(id)) continue
      const warmup = getWarmupConfig(this._dmStartDates.get(id))
      if ((this._dailySent.get(id) || 0) >= warmup.limit) continue
      if (this._workers.has(id)) continue // already running

      // Stagger start: random 10-60s offset per account
      const startDelay = 10_000 + Math.random() * 50_000
      this._workers.set(id, setTimeout(() => this._workerLoop(id), startDelay))
    }
  }

  async _workerLoop(accountId) {
    if (!this._running) { this._workers.delete(accountId); return }

    // Reset daily counters at midnight
    const today = new Date().toDateString()
    if (today !== this._dayStart) {
      this._dayStart = today
      this._dailySent.clear()
      this._floodedAccounts.clear()
      this.orchestrator.log(null, '📨 DM: новый день — счётчики сброшены', 'system')
      // Restart all workers for new day
      this._startAllWorkers()
    }

    const session = this.orchestrator.telegramAccounts.get(accountId)
    if (!session || session.status !== 'active' || !session.client?.connected) {
      this._workers.delete(accountId)
      return
    }

    // Check daily limit (warmup-aware)
    const warmup = getWarmupConfig(this._dmStartDates.get(accountId))
    const sent = this._dailySent.get(accountId) || 0
    if (sent >= warmup.limit) {
      const startDate = this._dmStartDates.get(accountId)
      const day = startDate ? Math.floor((Date.now() - new Date(startDate).getTime()) / 86400000) + 1 : 1
      this.orchestrator.log(null, `📨 @${session.username} — лимит ${sent}/${warmup.limit} (день ${day} прогрева)`, 'system')
      this._workers.delete(accountId)
      return
    }

    try {
      // Get one pending girl
      const girls = await this.orchestrator.db.dbGetPendingGirls(1)
      if (girls.length === 0) {
        // No more pending — stop this worker, check again in 10 min
        this._workers.set(accountId, setTimeout(() => this._workerLoop(accountId), 10 * 60_000))
        return
      }

      const girl = girls[0]
      await this._sendDm({ id: accountId, session }, girl)

    } catch (err) {
      this.orchestrator.log(null, `📨 Worker @${session.username} error: ${err.message}`, 'warn')
    }

    // Schedule next DM for THIS account (warmup-aware delays)
    if (this._running && !this._floodedAccounts.has(accountId)) {
      const delay = warmup.delayMin + Math.random() * (warmup.delayMax - warmup.delayMin)
      this._workers.set(accountId, setTimeout(() => this._workerLoop(accountId), delay))
    } else {
      this._workers.delete(accountId)
    }
  }

  async _sendDm(account, girl) {
    const { id: accountId, session } = account
    const message = getMessageForGirl(girl)

    try {
      // Resolve user
      let inputUser
      if (girl.username) {
        try {
          const result = await session.client.invoke(
            new Api.contacts.ResolveUsername({ username: girl.username.replace(/^@/, '') })
          )
          if (result?.users?.length > 0) {
            const u = result.users[0]
            inputUser = new Api.InputUser({ userId: u.id, accessHash: u.accessHash })
          }
        } catch (_) {}
      }
      if (!inputUser && girl.access_hash) {
        inputUser = new Api.InputUser({
          userId: BigInt(girl.user_id),
          accessHash: BigInt(girl.access_hash),
        })
      }
      if (!inputUser) {
        try {
          const entity = await session.client.getEntity(BigInt(girl.user_id))
          if (entity) {
            inputUser = new Api.InputUser({ userId: entity.id, accessHash: entity.accessHash })
          }
        } catch (_) {}
      }

      if (!inputUser) {
        await this.orchestrator.db.dbUpdateGirlDmStatus(girl.id, 'failed', null, 'CANNOT_RESOLVE')
        return
      }

      // Send message
      await session.client.sendMessage(inputUser, { message })

      // Update DB
      await this.orchestrator.db.dbUpdateGirlDmStatus(girl.id, 'sent', session.username || session.phone)

      // Track warmup start date (first DM ever from this account)
      if (!this._dmStartDates.has(accountId)) {
        this._dmStartDates.set(accountId, new Date().toISOString())
      }

      // Update daily counter
      this._dailySent.set(accountId, (this._dailySent.get(accountId) || 0) + 1)
      const sent = this._dailySent.get(accountId)

      const warmup = getWarmupConfig(this._dmStartDates.get(accountId))
      this.orchestrator.log(null,
        `📨 ✅ @${session.username} → @${girl.username || girl.user_id} (${girl.first_name}) [${sent}/${warmup.limit}]`,
        'system'
      )

    } catch (err) {
      const msg = err.errorMessage || err.message || 'Unknown'

      if (msg === 'PEER_FLOOD' || msg === 'PeerFloodError') {
        this._dailySent.set(accountId, 999) // max out to stop this account
        this._floodedAccounts.add(accountId)
        this.orchestrator.log(null, `📨 🚫 @${session.username} — PeerFlood, снят на сегодня`, 'warn')
        await this.orchestrator.db.dbUpdateGirlDmStatus(girl.id, 'pending') // return to queue
        return
      }

      if (msg === 'USER_PRIVACY_RESTRICTED') {
        await this.orchestrator.db.dbUpdateGirlDmStatus(girl.id, 'skipped', null, 'PRIVACY')
        return
      }

      if (msg.startsWith('FLOOD_WAIT')) {
        const seconds = parseInt(msg.split('_').pop()) || err.seconds || 300
        this.orchestrator.log(null, `📨 ⏳ @${session.username} FloodWait ${seconds}с`, 'warn')
        await new Promise(r => setTimeout(r, seconds * 1000))
        await this.orchestrator.db.dbUpdateGirlDmStatus(girl.id, 'pending')
        return
      }

      await this.orchestrator.db.dbUpdateGirlDmStatus(girl.id, 'failed', null, msg)
      this.orchestrator.log(null, `📨 ❌ @${session.username} → @${girl.username || girl.user_id}: ${msg}`, 'warn')
    }
  }
}
