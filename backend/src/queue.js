import { parseSpintax } from './spintax.js'
import { humanDelay } from './human-delay.js'
import {
  dbMarkLeadSent, dbMarkLeadFailed, dbIncrementCampaignSent, dbIncrementCampaignErrors,
  dbMarkTelegramLeadSent, dbMarkTelegramLeadFailed, dbIncrementTgCampaignSent, dbIncrementTgCampaignErrors,
} from './db.js'

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * @typedef {{ id: string, phone: string, campaignId: string, template: string,
 *             sessionPhone: string, delayMinSec: number, delayMaxSec: number,
 *             platform?: 'whatsapp' | 'telegram' }} QueueItem
 */

export class MessageQueue {
  /**
   * @param {import('./orchestrator.js').Orchestrator} orchestrator
   * @param {'whatsapp' | 'telegram'} platform
   */
  constructor(orchestrator, platform = 'whatsapp') {
    this.orchestrator = orchestrator
    this.platform = platform
    /** @type {QueueItem[]} */
    this.items = []
    this.status = 'stopped'  // 'running' | 'paused' | 'stopped'
    this._processing = false
    this._stopSignal = false
    this._pauseResolve = null
  }

  get size() {
    return this.items.length
  }

  /** Add a single item to the end of the queue */
  add(item) {
    this.items.push(item)
    this.orchestrator.broadcast({ type: 'stats_update', inQueueDelta: 1, platform: this.platform })
  }

  /** Add multiple items */
  addBatch(items) {
    this.items.push(...items)
  }

  /** Start processing (non-blocking — runs in background) */
  start() {
    if (this._processing) {
      this.status = 'running'
      this._resumePause()
      return
    }
    this.status = 'running'
    this._stopSignal = false
    this._processing = true
    this._messageIndex = 0
    this._process().finally(() => {
      this._processing = false
      this._messageIndex = 0
      if (this.status !== 'stopped') this.status = 'stopped'
    })
  }

  pause() {
    this.status = 'paused'
    this.orchestrator.log(null, `${this._platformLabel()} очередь на паузе`, 'warn', this.platform)
  }

  stop() {
    this.status = 'stopped'
    this._stopSignal = true
    this._resumePause()
    this.orchestrator.log(null, `${this._platformLabel()} очередь остановлена`, 'warn', this.platform)
  }

  clear() {
    this.items = []
  }

  _platformLabel() {
    return this.platform === 'telegram' ? 'TG' : 'WA'
  }

  _resumePause() {
    if (this._pauseResolve) {
      this._pauseResolve()
      this._pauseResolve = null
    }
  }

  async _waitWhilePaused() {
    while (this.status === 'paused') {
      await new Promise(resolve => {
        this._pauseResolve = resolve
        setTimeout(resolve, 1_000)  // poll every second
      })
    }
  }

  async _process() {
    this.orchestrator.log(null, `${this._platformLabel()} очередь запущена — ${this.items.length} лидов`, 'info', this.platform)

    while (this.items.length > 0 && !this._stopSignal) {
      // Wait if paused
      if (this.status === 'paused') {
        await this._waitWhilePaused()
      }
      if (this._stopSignal) break

      const item = this.items[0]
      const itemPlatform = item.platform || this.platform

      // Find an online session/bot
      const session = this._findOnlineSession(item.sessionPhone, itemPlatform)
      if (!session) {
        this.orchestrator.log(item.sessionPhone, `Сессия не в сети — ожидание 30с`, 'warn', itemPlatform)
        await this._sleepWithCheck(30_000)
        if (this._stopSignal) break
        continue
      }

      // Human-like delay before sending (Gaussian distribution, fatigue, distraction pauses)
      const delaySec = humanDelay(item.delayMinSec, item.delayMaxSec, this._messageIndex || 0, this.items.length)
      this._messageIndex = (this._messageIndex || 0) + 1
      this.orchestrator.log(
        item.sessionPhone,
        `Ожидание ${delaySec}с перед отправкой на ${item.phone}`,
        'info',
        itemPlatform
      )
      this.orchestrator.broadcast({
        type: 'queue_tick',
        next_phone: item.phone,
        delay_sec: delaySec,
        session: item.sessionPhone,
        platform: itemPlatform,
      })

      await this._sleepWithCheck(delaySec * 1_000)
      if (this._stopSignal) break

      // Re-check pause after delay
      if (this.status === 'paused') {
        await this._waitWhilePaused()
        if (this._stopSignal) break
      }

      // Remove from queue before attempting send
      this.items.shift()

      // Daily limit check
      if (itemPlatform === 'whatsapp' && !this.orchestrator.canSend(item.sessionPhone)) {
        this.orchestrator.log(item.sessionPhone, `⚠ Дневной лимит ${this.orchestrator.DAILY_LIMIT} сообщений — пропускаю ${item.phone}`, 'warn', itemPlatform)
        continue
      }

      try {
        const text = parseSpintax(item.template)
        const result = await session.sendMessage(item.phone, text)

        // Store outbound message for CRM (WhatsApp only)
        if (itemPlatform === 'whatsapp') {
          this.orchestrator.storeMessage(
            item.sessionPhone, item.phone, 'outbound', text,
            result?.key?.id, item.id,
          )
        }

        // Mark lead as sent — different DB functions per platform
        if (itemPlatform === 'telegram') {
          await Promise.allSettled([
            dbMarkTelegramLeadSent(item.id),
            dbIncrementTgCampaignSent(item.campaignId),
          ])
        } else {
          await Promise.allSettled([
            dbMarkLeadSent(item.id),
            dbIncrementCampaignSent(item.campaignId),
          ])
        }

        // Track daily limit
        if (itemPlatform === 'whatsapp') {
          this.orchestrator._incrementDailyCount(item.sessionPhone)
        }

        this.orchestrator.broadcast({ type: 'stats_update', sentDelta: 1, inQueueDelta: -1, platform: itemPlatform })
        const dailyLeft = this.orchestrator.DAILY_LIMIT - this.orchestrator._getDailyCount(item.sessionPhone)
        this.orchestrator.log(
          item.sessionPhone,
          `✓ Отправлено на ${item.phone} (очередь: ${this.items.length}) [${dailyLeft}/${this.orchestrator.DAILY_LIMIT} осталось]`,
          'info',
          itemPlatform
        )
      } catch (err) {
        if (itemPlatform === 'telegram') {
          await Promise.allSettled([
            dbMarkTelegramLeadFailed(item.id, err.message),
            dbIncrementTgCampaignErrors(item.campaignId),
          ])
        } else {
          await Promise.allSettled([
            dbMarkLeadFailed(item.id, err.message),
            dbIncrementCampaignErrors(item.campaignId),
          ])
        }

        this.orchestrator.broadcast({ type: 'stats_update', errorsDelta: 1, inQueueDelta: -1, platform: itemPlatform })
        this.orchestrator.log(
          item.sessionPhone,
          `✗ Ошибка отправки на ${item.phone}: ${err.message}`,
          'error',
          itemPlatform
        )
      }
    }

    if (this.items.length === 0 && !this._stopSignal) {
      this.orchestrator.log(null, `${this._platformLabel()} очередь завершена — все лиды обработаны`, 'info', this.platform)
      this.status = 'stopped'
    }
  }

  /**
   * Find an online session (WA) or active bot (TG).
   */
  _findOnlineSession(preferredId, platform) {
    if (platform === 'telegram') {
      const { telegramAccounts } = this.orchestrator
      // Try preferred account first
      if (preferredId) {
        const a = telegramAccounts.get(preferredId)
        if (a?.status === 'active') return a
      }
      // Fallback: any active account
      for (const a of telegramAccounts.values()) {
        if (a.status === 'active') return a
      }
      return null
    }

    // WhatsApp
    const { sessions } = this.orchestrator
    // Try preferred session first
    if (preferredId) {
      const s = sessions.get(preferredId)
      if (s?.status === 'online') return s
    }
    // Fallback: any online session
    for (const s of sessions.values()) {
      if (s.status === 'online') return s
    }
    return null
  }

  /** Sleep but break early if stop signal is set */
  async _sleepWithCheck(ms) {
    const step = 1_000
    let elapsed = 0
    while (elapsed < ms) {
      if (this._stopSignal || this.status === 'stopped') return
      await sleep(Math.min(step, ms - elapsed))
      elapsed += step
    }
  }
}
