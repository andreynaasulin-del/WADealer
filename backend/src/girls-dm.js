/**
 * Girls DM Engine — mass DM working girls from 19 TG accounts.
 *
 * Strategy:
 * - Distribute girls across accounts evenly
 * - Max 25 DMs per account per day (conservative to avoid bans)
 * - 3-8 min delay between DMs from same account
 * - Vary message slightly per girl (name personalization)
 * - Track sent/failed/replied status in tg_girls table
 */

import { Api } from 'telegram'

const MAX_DMS_PER_ACCOUNT_PER_DAY = 25
const DM_DELAY_MIN = 3 * 60_000   // 3 min minimum between DMs
const DM_DELAY_MAX = 8 * 60_000   // 8 min maximum between DMs

// Message templates — Hebrew (Israel target market)
const MESSAGES_HE = [
  (name) => `היי${name ? ' ' + name : ''} 😊\nאת רוצה לפרסם את עצמך בחינם?\nיש לנו אתר חדש ודיסקרטי לפרסום — www.tahles.top\nאם מעניין אותך, מלאי שאלון קצר דרך הבוט: @Tahlesbot ✨`,

  (name) => `שלום${name ? ' ' + name : ''} 👋\nאנחנו מציעים פרסום חינם באתר דיסקרטי ובטוח — www.tahles.top\nרוצה לנסות? שלחי הודעה לבוט שלנו: @Tahlesbot 🌟`,

  (name) => `היי${name ? ' ' + name : ''} 💫\nמחפשת פלטפורמה לפרסום? יש לנו אתר חדש — www.tahles.top\nפרסום בחינם, דיסקרטי ובטוח.\nלפרטים ורישום: @Tahlesbot`,

  (name) => `הי${name ? ' ' + name : ''} 🌸\nרציתי להציע לך פרסום חינם באתר שלנו www.tahles.top\nאתר דיסקרטי ואיכותי.\nמעניין? שלחי /start לבוט @Tahlesbot`,
]

// Russian variants
const MESSAGES_RU = [
  (name) => `Привет${name ? ' ' + name : ''} 😊\nХочешь разместить анкету бесплатно?\nУ нас новый сайт — www.tahles.top\nДискретно и безопасно. Заполни анкету через бота: @Tahlesbot ✨`,

  (name) => `Привет${name ? ' ' + name : ''} 👋\nМы предлагаем бесплатное размещение на нашем сайте www.tahles.top\nЕсли интересно — напиши боту @Tahlesbot 🌟`,
]

// English variants
const MESSAGES_EN = [
  (name) => `Hey${name ? ' ' + name : ''} 😊\nWant to advertise yourself for free?\nCheck out our new platform — www.tahles.top\nDiscreet & safe. Register via @Tahlesbot ✨`,

  (name) => `Hi${name ? ' ' + name : ''} 👋\nWe offer free listing on our platform www.tahles.top\nInterested? Message our bot: @Tahlesbot 🌟`,
]

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function getMessageForGirl(girl) {
  const name = girl.first_name || ''
  // Determine language from bio/name
  const bio = (girl.bio || '').toLowerCase()
  const allText = `${name} ${bio}`

  // Hebrew characters present → Hebrew message
  if (/[\u0590-\u05ff]/.test(allText)) {
    return pick(MESSAGES_HE)(name)
  }
  // Russian characters → Russian
  if (/[\u0400-\u04ff]/.test(allText)) {
    return pick(MESSAGES_RU)(name)
  }
  // Default: Hebrew (Israel market)
  return pick(MESSAGES_HE)(name)
}

export class GirlsDmEngine {
  constructor(orchestrator) {
    this.orchestrator = orchestrator
    this._running = false
    this._timer = null
    this._dailySent = new Map() // accountId → count today
    this._dayStart = null
  }

  get isRunning() { return this._running }

  /**
   * Start the DM campaign. Runs continuously until stopped.
   */
  async start() {
    if (this._running) return
    this._running = true
    this._dayStart = new Date().toDateString()
    this._dailySent.clear()
    this.orchestrator.log(null, '📨 Girls DM кампания запущена', 'system')
    this._runLoop()
  }

  stop() {
    this._running = false
    if (this._timer) {
      clearTimeout(this._timer)
      this._timer = null
    }
    this.orchestrator.log(null, '⏹ Girls DM кампания остановлена', 'system')
  }

  getStats() {
    const stats = {}
    for (const [id, count] of this._dailySent) {
      stats[id] = count
    }
    return { running: this._running, dailySent: stats }
  }

  async _runLoop() {
    if (!this._running) return

    // Reset daily counters at midnight
    const today = new Date().toDateString()
    if (today !== this._dayStart) {
      this._dayStart = today
      this._dailySent.clear()
      this.orchestrator.log(null, '📨 DM: новый день — счётчики сброшены', 'system')
    }

    try {
      // Get available accounts (active + not hit daily limit)
      const availableAccounts = this._getAvailableAccounts()
      if (availableAccounts.length === 0) {
        this.orchestrator.log(null, '📨 DM: все аккаунты исчерпали дневной лимит или не активны', 'system')
        // Retry in 30 min
        this._timer = setTimeout(() => this._runLoop(), 30 * 60_000)
        return
      }

      // Get pending girls from DB
      const girls = await this.orchestrator.db.dbGetPendingGirls(availableAccounts.length)
      if (girls.length === 0) {
        this.orchestrator.log(null, '📨 DM: нет pending девушек для рассылки', 'system')
        this._timer = setTimeout(() => this._runLoop(), 10 * 60_000)
        return
      }

      // Send one DM from one account
      const account = availableAccounts[0]
      const girl = girls[0]

      await this._sendDm(account, girl)

      // Schedule next DM with delay
      const delay = DM_DELAY_MIN + Math.random() * (DM_DELAY_MAX - DM_DELAY_MIN)
      this._timer = setTimeout(() => this._runLoop(), delay)

    } catch (err) {
      this.orchestrator.log(null, `📨 DM loop error: ${err.message}`, 'warn')
      this._timer = setTimeout(() => this._runLoop(), 5 * 60_000)
    }
  }

  _getAvailableAccounts() {
    const accounts = []
    for (const [id, session] of this.orchestrator.telegramAccounts) {
      if (session.status !== 'active' || !session.client?.connected) continue
      const sent = this._dailySent.get(id) || 0
      if (sent >= MAX_DMS_PER_ACCOUNT_PER_DAY) continue
      accounts.push({ id, session, sent })
    }
    // Sort by least used first (distribute evenly)
    accounts.sort((a, b) => a.sent - b.sent)
    return accounts
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
        this.orchestrator.log(null, `📨 ❌ Не удалось найти @${girl.username || girl.user_id}`, 'warn')
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
        // Account hit flood limit — remove from rotation for today
        this._dailySent.set(accountId, MAX_DMS_PER_ACCOUNT_PER_DAY)
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
        this.orchestrator.log(null, `📨 ⏳ FloodWait ${seconds}с для @${session.username}`, 'warn')
        await new Promise(r => setTimeout(r, seconds * 1000))
        await this.orchestrator.db.dbUpdateGirlDmStatus(girl.id, 'pending') // retry later
        return
      }

      await this.orchestrator.db.dbUpdateGirlDmStatus(girl.id, 'failed', null, msg)
      this.orchestrator.log(null, `📨 ❌ DM error @${girl.username || girl.user_id}: ${msg}`, 'warn')
    }
  }
}
