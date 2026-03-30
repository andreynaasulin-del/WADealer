/**
 * WA Farmer — WhatsApp account warmup and health monitoring bot.
 *
 * For platform-owned accounts (owner_type = 'platform'):
 *   Full warmup cycle: set profile → inter-account messaging → join groups → activity ramp-up
 *
 * For user-owned accounts (owner_type = 'user'):
 *   Monitoring only: keepalive, health check, ban detection, notifications
 */

import {
  dbGetWarmingAccounts, dbGetFarmAccounts, dbUpdateFarmAccount, dbGetFarmAccount,
} from './db.js'

// ─── Warmup Schedule ──────────────────────────────────────────────────────────
const WARMUP_SCHEDULE = [
  // day range, max messages/day, delay range (min), actions
  { dayMin: 1,  dayMax: 3,  maxMsg: 0,  delayMin: 0,  delayMax: 0,  actions: ['profile'] },
  { dayMin: 4,  dayMax: 7,  maxMsg: 5,  delayMin: 20, delayMax: 30, actions: ['inter_msg'] },
  { dayMin: 8,  dayMax: 14, maxMsg: 10, delayMin: 15, delayMax: 25, actions: ['inter_msg', 'join_group', 'read_groups'] },
  { dayMin: 15, dayMax: 21, maxMsg: 15, delayMin: 10, delayMax: 20, actions: ['inter_msg', 'group_reply', 'status_change'] },
  { dayMin: 22, dayMax: 30, maxMsg: 20, delayMin: 8,  delayMax: 15, actions: ['inter_msg', 'group_reply', 'status_change', 'full_sim'] },
]

function getScheduleForDay(day) {
  for (const s of WARMUP_SCHEDULE) {
    if (day >= s.dayMin && day <= s.dayMax) return s
  }
  return WARMUP_SCHEDULE[WARMUP_SCHEDULE.length - 1]
}

// ─── Health Score Calculator ─────────────────────────────────────────────────

export function calculateHealthScore(account) {
  let score = 0
  const now = Date.now()

  // +20: Session online > 24h
  if (account.last_activity_at) {
    const lastActive = new Date(account.last_activity_at).getTime()
    if (now - lastActive < 24 * 60 * 60 * 1000) score += 20
  }

  // +20: Sent > 10 messages in last 7 days
  if (account.messages_sent_total > 10) score += 20

  // +20: Received > 5 messages in last 7 days
  if (account.messages_received_total > 5) score += 20

  // +15: In > 2 groups
  if (account.groups_joined > 2) score += 15

  // +15: Has avatar + status
  if (account.has_avatar && account.has_status) score += 15

  // +10: Account > 14 days old
  if (account.registered_at) {
    const age = now - new Date(account.registered_at).getTime()
    if (age > 14 * 24 * 60 * 60 * 1000) score += 10
  }

  // -30: Was banned in last 30 days
  if (account.last_ban_at) {
    const banAge = now - new Date(account.last_ban_at).getTime()
    if (banAge < 30 * 24 * 60 * 60 * 1000) score -= 30
  }

  return Math.max(0, Math.min(100, score))
}

// ─── Farmer Class ────────────────────────────────────────────────────────────

export class WaFarmer {
  constructor(orchestrator) {
    this.orchestrator = orchestrator
    this._interval = null
    this._healthInterval = null
    this._running = false
  }

  /** Start the farming loop */
  start() {
    if (this._running) return
    this._running = true

    // Warmup loop: every 10 minutes
    this._interval = setInterval(() => this._warmupTick(), 10 * 60 * 1000)

    // Health check: every 30 minutes
    this._healthInterval = setInterval(() => this._healthCheckTick(), 30 * 60 * 1000)

    // Initial tick after 30s delay
    setTimeout(() => {
      this._warmupTick()
      this._healthCheckTick()
    }, 30_000)

    this.orchestrator.log(null, '[FARMER] WhatsApp farming bot started', 'info')
  }

  stop() {
    this._running = false
    if (this._interval) clearInterval(this._interval)
    if (this._healthInterval) clearInterval(this._healthInterval)
    this.orchestrator.log(null, '[FARMER] WhatsApp farming bot stopped', 'info')
  }

  // ── Warmup tick: process all warming accounts ──────────────────────────────

  async _warmupTick() {
    try {
      const accounts = await dbGetWarmingAccounts()
      if (accounts.length === 0) return

      for (const account of accounts) {
        if (account.owner_type === 'user') {
          await this._processUserWarmup(account)
          continue
        }

        const schedule = getScheduleForDay(account.warmup_day)
        await this._processWarmup(account, schedule)
      }
    } catch (err) {
      console.error('[FARMER] warmup tick error:', err.message)
    }
  }

  async _processWarmup(account, schedule) {
    const session = this.orchestrator.sessions.get(account.session_phone || account.phone_number)

    if (!session || session.status !== 'online') {
      // Session not connected — try to reconnect
      this.orchestrator.log(account.phone_number, `[FARMER] Session offline, skipping warmup`, 'warn')
      return
    }

    // Increment warmup day (once per day based on warmup_started_at)
    const daysSinceStart = account.warmup_started_at
      ? Math.floor((Date.now() - new Date(account.warmup_started_at).getTime()) / (24 * 60 * 60 * 1000))
      : 0

    if (daysSinceStart > account.warmup_day) {
      await dbUpdateFarmAccount(account.id, { warmup_day: daysSinceStart })
      account.warmup_day = daysSinceStart
    }

    // Execute actions based on schedule
    for (const action of schedule.actions) {
      try {
        switch (action) {
          case 'profile':
            await this._setProfile(account, session)
            break
          case 'inter_msg':
            await this._sendInterAccountMessage(account, session, schedule)
            break
          case 'join_group':
            // Only join groups periodically (1/day)
            if (Math.random() < 0.1) await this._joinRandomGroup(account, session)
            break
          case 'read_groups':
            await this._readGroupMessages(account, session)
            break
          case 'group_reply':
            if (Math.random() < 0.05) await this._replyInGroup(account, session)
            break
          case 'status_change':
            if (Math.random() < 0.15) await this._updateStatus(account, session)
            break
          case 'full_sim':
            // Full simulation — combination of random actions
            break
        }
      } catch (err) {
        this.orchestrator.log(account.phone_number, `[FARMER] Action ${action} failed: ${err.message}`, 'warn')
      }
    }

    // Update last activity
    await dbUpdateFarmAccount(account.id, {
      last_activity_at: new Date().toISOString(),
    })

    // Check if ready (30+ days, health > 80)
    if (account.warmup_day >= 30) {
      const health = calculateHealthScore(account)
      if (health >= 80) {
        await dbUpdateFarmAccount(account.id, { stage: 'ready', ready_at: new Date().toISOString(), health_score: health })
        this.orchestrator.log(account.phone_number, `[FARMER] Account READY! Health: ${health}`, 'info')
      }
    }
  }

  // ── Light warmup for user-owned accounts ─────────────────────────────────

  async _processUserWarmup(account) {
    const session = this.orchestrator.sessions.get(account.session_phone || account.phone_number)
    if (!session || session.status !== 'online') return

    // Only once per 8 hours
    if (account.last_activity_at) {
      const hoursSinceLast = (Date.now() - new Date(account.last_activity_at).getTime()) / 3_600_000
      if (hoursSinceLast < 8) return
    }

    try {
      await this._sendInterAccountMessage(account, session, { delayMin: 5, delayMax: 15 })
      this.orchestrator.log(account.phone_number, `[FARMER] User account warmup ping sent`, 'info')
    } catch (err) {
      this.orchestrator.log(account.phone_number, `[FARMER] User warmup error: ${err.message}`, 'warn')
    }
  }

  // ── Profile setup (days 1-3) ───────────────────────────────────────────────

  async _setProfile(account, session) {
    if (account.has_avatar && account.has_status) return

    try {
      // Set display name
      if (account.display_name && session.sock?.updateProfileName) {
        await session.sock.updateProfileName(account.display_name)
      }

      // Set status
      if (!account.has_status && session.sock?.updateProfileStatus) {
        const statuses = [
          'Hey there! I am using WhatsApp',
          'Available',
          'Busy at work',
          'At the gym',
          'Living my best life',
        ]
        const status = statuses[Math.floor(Math.random() * statuses.length)]
        await session.sock.updateProfileStatus(status)
        await dbUpdateFarmAccount(account.id, { has_status: true, status_updates: (account.status_updates || 0) + 1 })
      }
    } catch (err) {
      this.orchestrator.log(account.phone_number, `[FARMER] Profile setup error: ${err.message}`, 'warn')
    }
  }

  // ── Inter-account messaging (days 4+) ──────────────────────────────────────

  async _sendInterAccountMessage(account, session, schedule) {
    // Find another farm account that's online to message
    try {
      const allFarmAccounts = await dbGetFarmAccounts({ stage: 'warming', owner_type: 'platform' })
      const peers = allFarmAccounts.filter(a =>
        a.id !== account.id &&
        a.phone_number !== account.phone_number &&
        a.warmup_day >= 4
      )

      if (peers.length === 0) return

      const peer = peers[Math.floor(Math.random() * peers.length)]
      const jid = peer.phone_number.replace(/\D/g, '') + '@s.whatsapp.net'

      const messages = [
        'Hey, how are you?',
        'Good morning!',
        'What are you up to?',
        'Did you see the news today?',
        'Have a great day!',
        'Thanks for the message!',
        'Sure, sounds good',
        'I will check and get back to you',
        'LOL that is funny',
        'See you later!',
      ]

      const msg = messages[Math.floor(Math.random() * messages.length)]

      // Random delay before sending (human-like)
      const delay = (schedule.delayMin + Math.random() * (schedule.delayMax - schedule.delayMin)) * 60 * 1000
      await new Promise(r => setTimeout(r, Math.min(delay, 5 * 60 * 1000))) // Max 5 min wait

      await session.sendMessage(jid, msg)

      await dbUpdateFarmAccount(account.id, {
        messages_sent_total: (account.messages_sent_total || 0) + 1,
        last_activity_at: new Date().toISOString(),
      })

      this.orchestrator.log(account.phone_number, `[FARMER] Sent warmup msg to ${peer.phone_number}`, 'info')
    } catch (err) {
      this.orchestrator.log(account.phone_number, `[FARMER] Inter-msg error: ${err.message}`, 'warn')
    }
  }

  // ── Group actions ──────────────────────────────────────────────────────────

  async _joinRandomGroup(account, session) {
    // Placeholder — joining groups requires invite links
    // In production, maintain a list of safe public Israeli groups
    this.orchestrator.log(account.phone_number, `[FARMER] Group join placeholder (needs group list)`, 'info')
  }

  async _readGroupMessages(account, session) {
    // Reading messages is passive — Baileys handles this via message events
    // Just mark as activity
    await dbUpdateFarmAccount(account.id, {
      last_activity_at: new Date().toISOString(),
    })
  }

  async _replyInGroup(account, session) {
    // Placeholder — requires active group participation logic
    this.orchestrator.log(account.phone_number, `[FARMER] Group reply placeholder`, 'info')
  }

  // ── Status updates ─────────────────────────────────────────────────────────

  async _updateStatus(account, session) {
    try {
      if (!session.sock?.updateProfileStatus) return

      const statuses = [
        'Working hard',
        'Out for lunch',
        'Coffee time',
        'In a meeting',
        'Weekend mode',
        'Reading a good book',
        'At the beach',
        'Just chilling',
      ]
      const status = statuses[Math.floor(Math.random() * statuses.length)]
      await session.sock.updateProfileStatus(status)
      await dbUpdateFarmAccount(account.id, {
        status_updates: (account.status_updates || 0) + 1,
        has_status: true,
      })
    } catch (err) {
      // ignore
    }
  }

  // ── Health check tick ──────────────────────────────────────────────────────

  async _healthCheckTick() {
    try {
      // Check ALL farm accounts (including user-owned)
      const accounts = await dbGetFarmAccounts({})
      if (accounts.length === 0) return

      for (const account of accounts) {
        if (account.stage === 'banned' || account.stage === 'replaced') continue

        const health = calculateHealthScore(account)

        // Check session status for ban detection
        const session = this.orchestrator.sessions.get(account.session_phone || account.phone_number)

        const updates = { health_score: health }

        if (session?.status === 'banned') {
          updates.stage = 'banned'
          updates.ban_count = (account.ban_count || 0) + 1
          updates.last_ban_at = new Date().toISOString()
          updates.ban_reason = 'detected_by_session'

          this.orchestrator.log(account.phone_number, `[FARMER] Account BANNED! Ban count: ${updates.ban_count}`, 'error')

          // Notify via WebSocket
          this.orchestrator.broadcast({
            type: 'farm_account_banned',
            phone: account.phone_number,
            owner_type: account.owner_type,
            ban_count: updates.ban_count,
          })
        }

        // Check if session has been offline > 24h
        if (account.last_activity_at) {
          const inactiveHours = (Date.now() - new Date(account.last_activity_at).getTime()) / (60 * 60 * 1000)
          if (inactiveHours > 24 && account.stage === 'warming') {
            this.orchestrator.log(account.phone_number, `[FARMER] No activity for ${Math.round(inactiveHours)}h — needs attention`, 'warn')
          }
        }

        await dbUpdateFarmAccount(account.id, updates)
      }
    } catch (err) {
      console.error('[FARMER] health check error:', err.message)
    }
  }

  // ── Manual actions ─────────────────────────────────────────────────────────

  /** Start warmup for a specific account */
  async startWarmup(accountId) {
    const account = await dbGetFarmAccount(accountId)
    if (!account) throw new Error('Account not found')
    if (account.stage !== 'registered' && account.stage !== 'verified') {
      throw new Error(`Cannot start warmup from stage: ${account.stage}`)
    }

    return await dbUpdateFarmAccount(accountId, {
      stage: 'warming',
      warmup_started_at: new Date().toISOString(),
      warmup_day: 0,
    })
  }

  /** Register a user's own account for monitoring */
  async registerUserAccount(phone, userId, teamId, proxy) {
    const { dbCreateFarmAccount } = await import('./db.js')
    return await dbCreateFarmAccount({
      phone_number: phone,
      provider: 'user-own',
      owner_user_id: userId,
      owner_type: 'user',
      team_id: teamId,
      proxy_string: proxy,
    })
  }
}

export default WaFarmer
