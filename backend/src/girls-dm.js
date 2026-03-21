/**
 * Girls DM Engine — mass DM working girls from 19 TG accounts.
 *
 * Each account runs as independent worker with its own timer.
 * Max 25 DMs per account per day, 3-8 min between messages.
 * All 19 accounts work IN PARALLEL = up to 19 DMs every 3-8 min.
 */

import { Api } from 'telegram'

const MAX_DMS_PER_ACCOUNT_PER_DAY = 25
const DM_DELAY_MIN = 3 * 60_000   // 3 min
const DM_DELAY_MAX = 8 * 60_000   // 8 min

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
  }

  get isRunning() { return this._running }

  async start() {
    if (this._running) return
    this._running = true
    this._dayStart = new Date().toDateString()
    this._dailySent.clear()
    this._floodedAccounts.clear()
    this.orchestrator.log(null, '📨 Girls DM кампания запущена', 'system')

    // Start a worker for EACH active account
    this._startAllWorkers()
  }

  stop() {
    this._running = false
    for (const [id, timer] of this._workers) {
      clearTimeout(timer)
    }
    this._workers.clear()
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

  _startAllWorkers() {
    for (const [id, session] of this.orchestrator.telegramAccounts) {
      if (session.status !== 'active' || !session.client?.connected) continue
      if (this._floodedAccounts.has(id)) continue
      if ((this._dailySent.get(id) || 0) >= MAX_DMS_PER_ACCOUNT_PER_DAY) continue
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

    // Check daily limit
    const sent = this._dailySent.get(accountId) || 0
    if (sent >= MAX_DMS_PER_ACCOUNT_PER_DAY) {
      this.orchestrator.log(null, `📨 @${session.username} — достиг лимита ${sent}/${MAX_DMS_PER_ACCOUNT_PER_DAY}`, 'system')
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

    // Schedule next DM for THIS account
    if (this._running && !this._floodedAccounts.has(accountId)) {
      const delay = DM_DELAY_MIN + Math.random() * (DM_DELAY_MAX - DM_DELAY_MIN)
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

      // Update daily counter
      this._dailySent.set(accountId, (this._dailySent.get(accountId) || 0) + 1)
      const sent = this._dailySent.get(accountId)

      this.orchestrator.log(null,
        `📨 ✅ @${session.username} → @${girl.username || girl.user_id} (${girl.first_name}) [${sent}/${MAX_DMS_PER_ACCOUNT_PER_DAY}]`,
        'system'
      )

    } catch (err) {
      const msg = err.errorMessage || err.message || 'Unknown'

      if (msg === 'PEER_FLOOD' || msg === 'PeerFloodError') {
        this._dailySent.set(accountId, MAX_DMS_PER_ACCOUNT_PER_DAY)
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
