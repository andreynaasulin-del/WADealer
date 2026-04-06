import { Bot, InlineKeyboard, InputFile } from 'grammy'
import bcrypt from 'bcrypt'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = path.resolve(__dirname, '../data/bot-config.json')

// ─── TTL Map — auto-evicts entries after maxAge ──────────────────────────────

class TTLMap {
  constructor(maxAge = 24 * 60 * 60 * 1000) {
    this._map = new Map()
    this._maxAge = maxAge
    this._sweepTimer = setInterval(() => this._sweep(), 30 * 60 * 1000)
    this._sweepTimer.unref()
  }
  set(key, value) { this._map.set(key, { value, ts: Date.now() }) }
  get(key) {
    const entry = this._map.get(key)
    if (!entry) return undefined
    if (Date.now() - entry.ts > this._maxAge) { this._map.delete(key); return undefined }
    return entry.value
  }
  has(key) { return this.get(key) !== undefined }
  get size() { return this._map.size }
  _sweep() {
    const now = Date.now()
    for (const [key, entry] of this._map) {
      if (now - entry.ts > this._maxAge) this._map.delete(key)
    }
  }
  destroy() { clearInterval(this._sweepTimer); this._map.clear() }
}

// ─── Config persistence ──────────────────────────────────────────────────────

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch (err) { console.warn(`[WADealer Bot] Failed to load config: ${err.message}`) }
  return {}
}

function saveConfig(config) {
  try {
    const dir = path.dirname(CONFIG_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')
  } catch (err) { console.warn(`[WADealer Bot] Failed to save config: ${err.message}`) }
}

// ─── Module state ────────────────────────────────────────────────────────────

/** @type {Bot | null} */
let bot = null
let groupChatId = null
const messageMap = new TTLMap(24 * 60 * 60 * 1000)
let replySenderFn = null
let _orchestrator = null
let _db = null

const stats = {
  forwarded: 0,
  replied: 0,
  startedAt: null,
}

// ─── User auth state: tgUserId → { userId, teamId, email, isAdmin } ────────
const authedUsers = new Map()
// Pending login: tgUserId → { email, step }
const pendingLogin = new Map()
// Web deeplink auth states: state → { session_token, expires_at, user }
const botAuthStates = new TTLMap(5 * 60 * 1000) // 5 min TTL

export function setBotAuthState(state, data) { botAuthStates.set(state, data) }
export function getBotAuthState(state) { return botAuthStates.get(state) }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function esc(text) {
  if (!text) return ''
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function truncate(text, maxLen = 3500) {
  if (!text || text.length <= maxLen) return text
  return text.slice(0, maxLen) + '...'
}

function formatUptime(ms) {
  const secs = Math.floor(ms / 1000)
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const parts = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  parts.push(`${m}m`)
  return parts.join(' ')
}

// ─── Main menu keyboard ─────────────────────────────────────────────────────

function mainMenuKeyboard() {
  return new InlineKeyboard()
    .text('📊 Статистика', 'menu_stats')
    .text('📱 Сессии', 'menu_sessions').row()
    .text('📢 Кампании', 'menu_campaigns')
    .text('⏸ Пауза/Старт', 'menu_pause').row()
    .webApp('🌐 Открыть панель', 'https://wadealer.business')
    .text('❓ Помощь', 'menu_help')
}

// ─── Gather stats from orchestrator ──────────────────────────────────────────

// ─── Auth helpers for bot ────────────────────────────────────────────────────

function getAuthInfo(tgUserId) {
  return authedUsers.get(tgUserId) || null
}

function isAuthed(tgUserId) {
  return authedUsers.has(tgUserId)
}

function getSessionsInfo(auth = null) {
  if (!_orchestrator) return { wa: [], tg: [], waOnline: 0, tgOnline: 0 }

  // If auth provided and not admin — filter by user/team
  if (auth && !auth.isAdmin) {
    const filtered = _orchestrator.getAllSessionStates(auth.userId, auth.teamId)
    const wa = filtered.map(s => ({ phone: s.phone, status: s.status, name: s.phone }))
    return {
      wa,
      tg: [], // TG accounts not filtered yet
      waOnline: wa.filter(s => s.status === 'online').length,
      tgOnline: 0,
    }
  }

  const wa = []
  for (const s of _orchestrator.sessions.values()) {
    wa.push({ phone: s.phone, status: s.status, name: s.name || s.phone })
  }

  const tg = []
  for (const t of _orchestrator.telegramAccounts.values()) {
    tg.push({ phone: t.phone, status: t.status, username: t.username })
  }

  return {
    wa,
    tg,
    waOnline: wa.filter(s => s.status === 'online').length,
    tgOnline: tg.filter(s => s.status === 'active').length,
  }
}

async function getCampaignsInfo(auth = null) {
  if (!_db) return { wa: [], tg: [] }
  try {
    let waCampaigns = await _db.dbGetAllCampaigns()
    let tgCampaigns = await _db.dbGetAllTelegramCampaigns()

    // Filter by team if not admin
    if (auth && !auth.isAdmin && auth.teamId) {
      waCampaigns = (waCampaigns || []).filter(c => c.team_id === auth.teamId || c.user_id === auth.userId)
      tgCampaigns = (tgCampaigns || []).filter(c => c.team_id === auth.teamId || c.user_id === auth.userId)
    }

    return { wa: waCampaigns || [], tg: tgCampaigns || [] }
  } catch {
    return { wa: [], tg: [] }
  }
}

// ─── Forward to operator group ───────────────────────────────────────────────

export async function forwardToOperatorGroup({ from, name, message, channel, sessionPhone, contactId: rawContactId, mediaBuffer, mediaType, mediaMime }) {
  if (!bot || !groupChatId) return

  const channelIcon = channel === 'whatsapp' ? '📱' : '✈️'
  const channelLabel = channel === 'whatsapp' ? 'WhatsApp' : 'Telegram'
  const contactLine = channel === 'whatsapp'
    ? `+${from.replace(/^\+/, '')}`
    : (from.startsWith('@') ? from : `@${from}`)

  // Extract caption from media messages
  let caption = ''
  let cleanMessage = message || ''
  if (cleanMessage.startsWith('[media:')) {
    caption = cleanMessage.replace(/^\[media:[^\]]+\]\n?/, '').trim()
    cleanMessage = ''
  }

  const header = [
    `${channelIcon} <b>${channelLabel}</b> | <code>${esc(contactLine)}</code>`,
    `👤 ${esc(name || contactLine)}`,
    `📞 Session: <code>${esc(sessionPhone || '?')}</code>`,
  ].join('\n')

  try {
    let sent

    // Send media if buffer provided
    if (mediaBuffer && mediaType) {
      const mediaCaption = header + (caption ? `\n\n${esc(caption)}` : '')

      if (mediaType === 'image' || mediaType === 'sticker') {
        sent = await bot.api.sendPhoto(groupChatId, new InputFile(mediaBuffer, 'photo.jpg'), {
          caption: mediaCaption, parse_mode: 'HTML',
        })
      } else if (mediaType === 'video') {
        sent = await bot.api.sendVideo(groupChatId, new InputFile(mediaBuffer, 'video.mp4'), {
          caption: mediaCaption, parse_mode: 'HTML',
        })
      } else if (mediaType === 'audio') {
        sent = await bot.api.sendVoice(groupChatId, new InputFile(mediaBuffer, 'voice.ogg'), {
          caption: mediaCaption, parse_mode: 'HTML',
        })
      } else if (mediaType === 'document') {
        sent = await bot.api.sendDocument(groupChatId, new InputFile(mediaBuffer, 'file'), {
          caption: mediaCaption, parse_mode: 'HTML',
        })
      } else {
        // Fallback to text
        sent = await bot.api.sendMessage(groupChatId, header + '\n\n' + esc(truncate(message)), { parse_mode: 'HTML' })
      }
    } else {
      // Text-only message
      const displayMessage = esc(truncate(cleanMessage || message))
      const text = header + '\n\n' + displayMessage
      sent = await bot.api.sendMessage(groupChatId, text, { parse_mode: 'HTML' })
    }

    messageMap.set(sent.message_id, {
      contactId: rawContactId || from,
      channel,
      sessionPhone,
      name: name || contactLine,
    })
    stats.forwarded++
  } catch (err) {
    console.error(`[WADealer Bot] Forward failed: ${err.message}`)
  }
}

// ─── Notifications to operator group ─────────────────────────────────────────

export async function notifyGroup(text) {
  if (!bot || !groupChatId) return
  try {
    await bot.api.sendMessage(groupChatId, text, { parse_mode: 'HTML' })
  } catch {}
}

export async function notifySessionDown(phone, channel = 'whatsapp') {
  const icon = channel === 'whatsapp' ? '📱' : '✈️'
  await notifyGroup(`🔴 ${icon} <b>Сессия отключилась</b>\n<code>${esc(phone)}</code>`)
}

export async function notifySessionUp(phone, channel = 'whatsapp') {
  const icon = channel === 'whatsapp' ? '📱' : '✈️'
  await notifyGroup(`🟢 ${icon} <b>Сессия подключена</b>\n<code>${esc(phone)}</code>`)
}

export async function notifyCampaignDone(name, sent, failed) {
  await notifyGroup(
    `✅ <b>Кампания завершена</b>\n` +
    `📢 ${esc(name)}\n` +
    `📨 Отправлено: ${sent} | ❌ Ошибок: ${failed}`
  )
}

// ─── Reply sender registration ──────────────────────────────────────────────

export function setReplySender(fn) {
  replySenderFn = fn
}

// ─── Bot setup & commands ────────────────────────────────────────────────────

function setupBot(botInstance) {

  // ══════════════════════════════════════════════════════════════════════════
  // /start — welcome + inline menu
  // ══════════════════════════════════════════════════════════════════════════

  botInstance.command('start', async (ctx) => {
    const tgUserId = ctx.from?.id

    // In groups — no auth required, show summary
    if (ctx.chat.type !== 'private') {
      const { waOnline, tgOnline } = getSessionsInfo()
      return ctx.reply(`🟢 <b>WADealer</b> активен\n\nWA: ${waOnline} | TG: ${tgOnline} | 📨 ${stats.forwarded}`, {
        parse_mode: 'HTML',
        reply_markup: mainMenuKeyboard(),
      })
    }

    // ── Web deeplink: /start web_STATE ────────────────────────────────────────
    const startParam = ctx.match
    if (startParam && String(startParam).startsWith('web_')) {
      const state = String(startParam).slice(4)
      const syntheticEmail = `tg_${tgUserId}@wadealer.tg`
      const displayName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ')
        || ctx.from?.username || `TG_${tgUserId}`

      try {
        const {
          dbFindUserByEmail, dbCreateUser, dbCreateAuthSession,
          dbGetUserTeam, dbCreateTeam, dbAddTeamMember,
        } = await import('./db.js')
        const { getUserTeam } = await import('./auth-helpers.js')

        let user = await dbFindUserByEmail(syntheticEmail)
        if (!user) {
          user = await dbCreateUser(syntheticEmail, null, displayName, 'start')
        }

        // Ensure user has a team
        let teamInfo = await dbGetUserTeam(user.id)
        if (!teamInfo) {
          const team = await dbCreateTeam(`Team ${user.display_name || displayName}`, user.id)
          await dbAddTeamMember(team.id, user.id, 'admin')
          teamInfo = { team_id: team.id, role: 'admin', team_name: team.name }
        }

        const session = await dbCreateAuthSession(null, user.id)

        // Store state for polling endpoint
        botAuthStates.set(state, {
          session_token: session.token,
          expires_at: session.expires_at,
          user: {
            id: user.id, email: user.email, display_name: user.display_name,
            tier: user.tier, is_admin: user.is_admin,
            team_id: teamInfo.team_id, team_role: teamInfo.role, team_name: teamInfo.team_name,
          },
        })

        // Also register in bot auth map
        authedUsers.set(tgUserId, {
          userId: user.id, teamId: teamInfo.team_id,
          email: user.email, isAdmin: user.is_admin || false,
          displayName: user.display_name || displayName,
        })
        pendingLogin.delete(tgUserId)

        console.log(`[WADealer Bot] Web auth: tg=${tgUserId} → ${user.email}`)

        return ctx.reply(
          `✅ <b>Авторизация успешна!</b>\n\n` +
          `👤 ${esc(user.display_name || displayName)}\n` +
          `🆔 Telegram ID привязан к аккаунту\n\n` +
          `Вернитесь на сайт — вы уже авторизованы!\n\n` +
          `<a href="https://wadealer.business">🌐 Открыть WADealer</a>`,
          { parse_mode: 'HTML' }
        )
      } catch (err) {
        console.error(`[WADealer Bot] Web auth error: ${err.message}`)
        return ctx.reply(`❌ Ошибка авторизации: ${err.message}\n\nПопробуйте снова.`)
      }
    }

    // Private chat — check auth
    if (!isAuthed(tgUserId)) {
      pendingLogin.set(tgUserId, { step: 'email' })
      return ctx.reply(
        '🔐 <b>Авторизация WADealer</b>\n\n' +
        'Для доступа к боту нужно привязать ваш аккаунт.\n\n' +
        '📧 Введите ваш <b>email</b> (тот же что при регистрации):',
        { parse_mode: 'HTML' }
      )
    }

    // Authed — show personalized menu
    const auth = getAuthInfo(tgUserId)
    const { waOnline, tgOnline } = getSessionsInfo(auth)
    await ctx.reply(
      `👋 <b>Добро пожаловать, ${esc(auth.email)}!</b>\n\n` +
      `📱 WA сессий онлайн: <b>${waOnline}</b>\n` +
      `✈️ TG аккаунтов онлайн: <b>${tgOnline}</b>\n` +
      `📨 Пересылок за сессию: <b>${stats.forwarded}</b>\n\n` +
      `Выберите действие:`,
      { parse_mode: 'HTML', reply_markup: mainMenuKeyboard() }
    )
  })

  // ══════════════════════════════════════════════════════════════════════════
  // /logout — remove auth binding
  // ══════════════════════════════════════════════════════════════════════════

  botInstance.command('logout', async (ctx) => {
    if (ctx.chat.type !== 'private') return
    const tgUserId = ctx.from?.id
    if (authedUsers.has(tgUserId)) {
      authedUsers.delete(tgUserId)
      pendingLogin.delete(tgUserId)
      await ctx.reply('👋 Вы вышли из аккаунта. Используйте /start чтобы войти снова.')
    } else {
      await ctx.reply('Вы не авторизованы. Используйте /start')
    }
  })

  // ══════════════════════════════════════════════════════════════════════════
  // Inline button handlers
  // ══════════════════════════════════════════════════════════════════════════

  // ── Stats ──
  botInstance.callbackQuery('menu_stats', async (ctx) => {
    await ctx.answerCallbackQuery()
    const auth = getAuthInfo(ctx.from?.id)
    const info = getSessionsInfo(auth)
    const uptime = stats.startedAt ? formatUptime(Date.now() - stats.startedAt) : '—'
    const campaigns = await getCampaignsInfo(auth)

    const waRunning = campaigns.wa.filter(c => c.status === 'running').length
    const tgRunning = campaigns.tg.filter(c => c.status === 'running').length

    const lines = [
      '📊 <b>Статистика WADealer</b>',
      '',
      '━━━ Сессии ━━━',
      `📱 WhatsApp: <b>${info.waOnline}</b>/${info.wa.length} онлайн`,
      `✈️ Telegram: <b>${info.tgOnline}</b>/${info.tg.length} онлайн`,
      '',
      '━━━ Сообщения ━━━',
      `📨 Переслано в группу: <b>${stats.forwarded}</b>`,
      `📩 Ответов отправлено: <b>${stats.replied}</b>`,
      '',
      '━━━ Кампании ━━━',
      `📢 WA активных: <b>${waRunning}</b>/${campaigns.wa.length}`,
      `📢 TG активных: <b>${tgRunning}</b>/${campaigns.tg.length}`,
      '',
      `⏱ Аптайм: ${uptime}`,
      `🗂 Маппингов: ${messageMap.size}`,
    ]

    const kb = new InlineKeyboard().text('◀️ Назад', 'menu_back')
    await ctx.editMessageText(lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb })
  })

  // ── Sessions list ──
  botInstance.callbackQuery('menu_sessions', async (ctx) => {
    await ctx.answerCallbackQuery()
    const auth = getAuthInfo(ctx.from?.id)
    const info = getSessionsInfo(auth)

    const lines = ['📱 <b>Сессии</b>', '']

    if (info.wa.length > 0) {
      lines.push('<b>WhatsApp:</b>')
      for (const s of info.wa) {
        const icon = s.status === 'online' ? '🟢' : s.status === 'reconnecting' ? '🟡' : '🔴'
        lines.push(`${icon} <code>${esc(s.phone)}</code> — ${s.status}`)
      }
      lines.push('')
    }

    if (info.tg.length > 0) {
      lines.push('<b>Telegram:</b>')
      for (const t of info.tg) {
        const icon = t.status === 'active' ? '🟢' : t.status === 'connecting' ? '🟡' : '🔴'
        const label = t.username ? `@${t.username}` : t.phone
        lines.push(`${icon} <code>${esc(label)}</code> — ${t.status}`)
      }
    }

    if (info.wa.length === 0 && info.tg.length === 0) {
      lines.push('<i>Нет подключённых сессий</i>')
    }

    const kb = new InlineKeyboard().text('🔄 Обновить', 'menu_sessions').text('◀️ Назад', 'menu_back')
    await ctx.editMessageText(lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb })
  })

  // ── Campaigns ──
  botInstance.callbackQuery('menu_campaigns', async (ctx) => {
    await ctx.answerCallbackQuery()
    const auth = getAuthInfo(ctx.from?.id)
    const campaigns = await getCampaignsInfo(auth)
    const lines = ['📢 <b>Кампании</b>', '']

    const allCampaigns = [
      ...campaigns.wa.map(c => ({ ...c, type: 'WA' })),
      ...campaigns.tg.map(c => ({ ...c, type: 'TG' })),
    ].sort((a, b) => {
      const order = { running: 0, paused: 1, pending: 2, completed: 3, error: 4 }
      return (order[a.status] ?? 5) - (order[b.status] ?? 5)
    })

    if (allCampaigns.length === 0) {
      lines.push('<i>Нет кампаний</i>')
    } else {
      for (const c of allCampaigns.slice(0, 15)) {
        const statusIcon = { running: '▶️', paused: '⏸', completed: '✅', error: '❌', pending: '⏳' }[c.status] || '❓'
        const sent = c.sent_count || c.sent || 0
        const total = c.total_leads || c.total || 0
        const progress = total > 0 ? Math.round((sent / total) * 100) : 0
        const name = c.name || c.campaign_name || `#${c.id}`
        lines.push(`${statusIcon} <b>[${c.type}]</b> ${esc(name)}`)
        lines.push(`   ${sent}/${total} (${progress}%) — ${c.status}`)
      }
      if (allCampaigns.length > 15) {
        lines.push(`\n<i>... и ещё ${allCampaigns.length - 15}</i>`)
      }
    }

    const kb = new InlineKeyboard().text('🔄 Обновить', 'menu_campaigns').text('◀️ Назад', 'menu_back')
    await ctx.editMessageText(lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb })
  })

  // ── Pause/Resume ──
  botInstance.callbackQuery('menu_pause', async (ctx) => {
    await ctx.answerCallbackQuery()
    const auth = getAuthInfo(ctx.from?.id)
    const campaigns = await getCampaignsInfo(auth)
    const running = [...campaigns.wa, ...campaigns.tg].filter(c => c.status === 'running')
    const paused = [...campaigns.wa, ...campaigns.tg].filter(c => c.status === 'paused')

    const lines = [
      '⏸ <b>Управление рассылкой</b>',
      '',
      `▶️ Запущено: <b>${running.length}</b>`,
      `⏸ На паузе: <b>${paused.length}</b>`,
      '',
      'Выберите действие:',
    ]

    const kb = new InlineKeyboard()
    if (running.length > 0) {
      kb.text('⏸ Пауза ВСЕХ', 'action_pause_all').row()
    }
    if (paused.length > 0) {
      kb.text('▶️ Возобновить ВСЕ', 'action_resume_all').row()
    }
    kb.text('◀️ Назад', 'menu_back')

    await ctx.editMessageText(lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb })
  })

  // Action: pause all
  botInstance.callbackQuery('action_pause_all', async (ctx) => {
    await ctx.answerCallbackQuery('⏸ Ставлю на паузу...')
    if (_orchestrator) {
      try {
        const auth = getAuthInfo(ctx.from?.id)
        const campaigns = await getCampaignsInfo(auth)
        let count = 0
        for (const c of [...campaigns.wa, ...campaigns.tg]) {
          if (c.status === 'running') {
            try { await _orchestrator.pauseCampaign(c.id) } catch {}
            count++
          }
        }
        await ctx.editMessageText(`⏸ Поставлено на паузу: <b>${count}</b> кампаний`, {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard().text('◀️ Назад', 'menu_back'),
        })
      } catch (err) {
        await ctx.editMessageText(`❌ Ошибка: ${esc(err.message)}`, {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard().text('◀️ Назад', 'menu_back'),
        })
      }
    }
  })

  // Action: resume all
  botInstance.callbackQuery('action_resume_all', async (ctx) => {
    await ctx.answerCallbackQuery('▶️ Возобновляю...')
    if (_orchestrator) {
      try {
        const auth = getAuthInfo(ctx.from?.id)
        const campaigns = await getCampaignsInfo(auth)
        let count = 0
        for (const c of [...campaigns.wa, ...campaigns.tg]) {
          if (c.status === 'paused') {
            try { await _orchestrator.resumeCampaign(c.id) } catch {}
            count++
          }
        }
        await ctx.editMessageText(`▶️ Возобновлено: <b>${count}</b> кампаний`, {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard().text('◀️ Назад', 'menu_back'),
        })
      } catch (err) {
        await ctx.editMessageText(`❌ Ошибка: ${esc(err.message)}`, {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard().text('◀️ Назад', 'menu_back'),
        })
      }
    }
  })

  // ── Help ──
  botInstance.callbackQuery('menu_help', async (ctx) => {
    await ctx.answerCallbackQuery()
    const lines = [
      '❓ <b>WADealer Bot — Помощь</b>',
      '',
      '<b>Команды:</b>',
      '/start — Главное меню',
      '/stats — Статистика',
      '/sessions — Список сессий',
      '/campaigns — Кампании',
      '/pause — Поставить всё на паузу',
      '/resume — Возобновить рассылку',
      '/connect — Подключить эту группу',
      '/disconnect — Отключить группу',
      '/logout — Выйти из аккаунта',
      '',
      '<b>Как отвечать клиентам:</b>',
      '1. Бот пересылает входящие сообщения в группу',
      '2. Свайп влево (reply) на сообщение',
      '3. Напишите ответ — он уйдёт клиенту',
      '4. ✅ = доставлено, ❌ = ошибка',
      '',
      '<b>Уведомления:</b>',
      '🟢 Сессия подключена',
      '🔴 Сессия отключилась',
      '✅ Кампания завершена',
    ]

    const kb = new InlineKeyboard().text('◀️ Назад', 'menu_back')
    await ctx.editMessageText(lines.join('\n'), { parse_mode: 'HTML', reply_markup: kb })
  })

  // ── Back to main menu ──
  botInstance.callbackQuery('menu_back', async (ctx) => {
    await ctx.answerCallbackQuery()
    const auth = getAuthInfo(ctx.from?.id)
    const { waOnline, tgOnline } = getSessionsInfo(auth)
    const text = ctx.chat.type === 'private'
      ? `👋 <b>WADealer</b>\n\n📱 WA: <b>${waOnline}</b> | ✈️ TG: <b>${tgOnline}</b> | 📨 ${stats.forwarded}\n\nВыберите действие:`
      : `🟢 <b>WADealer</b>\n\nWA: ${waOnline} | TG: ${tgOnline} | 📨 ${stats.forwarded}`

    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: mainMenuKeyboard(),
    })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // Slash commands (also available directly)
  // ══════════════════════════════════════════════════════════════════════════

  botInstance.command('stats', async (ctx) => {
    const auth = getAuthInfo(ctx.from?.id)
    if (ctx.chat.type === 'private' && !auth) return ctx.reply('🔐 Сначала авторизуйтесь: /start')
    const info = getSessionsInfo(auth)
    const uptime = stats.startedAt ? formatUptime(Date.now() - stats.startedAt) : '—'
    const campaigns = await getCampaignsInfo(auth)
    const waRunning = campaigns.wa.filter(c => c.status === 'running').length
    const tgRunning = campaigns.tg.filter(c => c.status === 'running').length

    await ctx.reply(
      `📊 <b>Статистика</b>\n\n` +
      `📱 WA: ${info.waOnline}/${info.wa.length} | ✈️ TG: ${info.tgOnline}/${info.tg.length}\n` +
      `📨 Переслано: ${stats.forwarded} | 📩 Ответов: ${stats.replied}\n` +
      `📢 Кампании: WA ${waRunning} | TG ${tgRunning}\n` +
      `⏱ Аптайм: ${uptime}`,
      { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('📊 Подробнее', 'menu_stats') }
    )
  })

  botInstance.command('sessions', async (ctx) => {
    const auth = getAuthInfo(ctx.from?.id)
    if (ctx.chat.type === 'private' && !auth) return ctx.reply('🔐 Сначала авторизуйтесь: /start')
    const info = getSessionsInfo(auth)
    const lines = ['📱 <b>Сессии</b>', '']

    for (const s of info.wa) {
      const icon = s.status === 'online' ? '🟢' : '🔴'
      lines.push(`${icon} <code>${esc(s.phone)}</code> ${s.status}`)
    }
    for (const t of info.tg) {
      const icon = t.status === 'active' ? '🟢' : '🔴'
      lines.push(`${icon} <code>${esc(t.username ? '@' + t.username : t.phone)}</code> ${t.status}`)
    }
    if (info.wa.length === 0 && info.tg.length === 0) lines.push('<i>Нет сессий</i>')

    await ctx.reply(lines.join('\n'), {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().text('🔄 Обновить', 'menu_sessions'),
    })
  })

  botInstance.command('campaigns', async (ctx) => {
    const auth = getAuthInfo(ctx.from?.id)
    if (ctx.chat.type === 'private' && !auth) return ctx.reply('🔐 Сначала авторизуйтесь: /start')
    const campaigns = await getCampaignsInfo(auth)
    const all = [...campaigns.wa.map(c => ({ ...c, t: 'WA' })), ...campaigns.tg.map(c => ({ ...c, t: 'TG' }))]
    const running = all.filter(c => c.status === 'running')

    if (running.length === 0) {
      return ctx.reply('📢 Нет активных кампаний', {
        reply_markup: new InlineKeyboard().text('📢 Все кампании', 'menu_campaigns'),
      })
    }

    const lines = ['📢 <b>Активные кампании</b>', '']
    for (const c of running) {
      const sent = c.sent_count || c.sent || 0
      const total = c.total_leads || c.total || 0
      const pct = total > 0 ? Math.round(sent / total * 100) : 0
      lines.push(`▶️ [${c.t}] ${esc(c.name || c.campaign_name || '#' + c.id)} — ${sent}/${total} (${pct}%)`)
    }
    await ctx.reply(lines.join('\n'), {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().text('📢 Все кампании', 'menu_campaigns'),
    })
  })

  botInstance.command('pause', async (ctx) => {
    const auth = getAuthInfo(ctx.from?.id)
    if (ctx.chat.type === 'private' && !auth) return ctx.reply('🔐 Сначала авторизуйтесь: /start')
    if (!_orchestrator) return ctx.reply('⚠️ Оркестратор недоступен')
    const campaigns = await getCampaignsInfo(auth)
    let count = 0
    for (const c of [...campaigns.wa, ...campaigns.tg]) {
      if (c.status === 'running') {
        try { await _orchestrator.pauseCampaign(c.id); count++ } catch {}
      }
    }
    await ctx.reply(`⏸ Поставлено на паузу: <b>${count}</b> кампаний`, { parse_mode: 'HTML' })
  })

  botInstance.command('resume', async (ctx) => {
    const auth = getAuthInfo(ctx.from?.id)
    if (ctx.chat.type === 'private' && !auth) return ctx.reply('🔐 Сначала авторизуйтесь: /start')
    if (!_orchestrator) return ctx.reply('⚠️ Оркестратор недоступен')
    const campaigns = await getCampaignsInfo(auth)
    let count = 0
    for (const c of [...campaigns.wa, ...campaigns.tg]) {
      if (c.status === 'paused') {
        try { await _orchestrator.resumeCampaign(c.id); count++ } catch {}
      }
    }
    await ctx.reply(`▶️ Возобновлено: <b>${count}</b> кампаний`, { parse_mode: 'HTML' })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // /connect, /disconnect
  // ══════════════════════════════════════════════════════════════════════════

  botInstance.command('connect', async (ctx) => {
    if (ctx.chat.type === 'private') {
      return ctx.reply('⚠️ Эта команда работает только в группах.')
    }
    groupChatId = ctx.chat.id
    saveConfig({ groupChatId })
    console.log(`[WADealer Bot] Operator group connected: ${groupChatId}`)

    const { waOnline, tgOnline } = getSessionsInfo()
    await ctx.reply(
      '✅ <b>Группа подключена!</b>\n\n' +
      'Входящие сообщения от клиентов будут приходить сюда.\n' +
      'Отвечайте reply-ем на сообщение — ответ уйдёт клиенту.\n\n' +
      `📱 WA онлайн: <b>${waOnline}</b> | ✈️ TG: <b>${tgOnline}</b>`,
      { parse_mode: 'HTML' }
    )
  })

  botInstance.command('disconnect', async (ctx) => {
    if (ctx.chat.type === 'private') {
      return ctx.reply('⚠️ Эта команда работает только в группах.')
    }
    groupChatId = null
    saveConfig({})
    console.log(`[WADealer Bot] Operator group disconnected`)
    await ctx.reply('❌ Группа отключена. Сообщения больше не перенаправляются.')
  })

  // ══════════════════════════════════════════════════════════════════════════
  // /help
  // ══════════════════════════════════════════════════════════════════════════

  botInstance.command('help', async (ctx) => {
    await ctx.reply(
      '❓ <b>WADealer Bot</b>\n\n' +
      '/start — Главное меню с кнопками\n' +
      '/stats — Статистика\n' +
      '/sessions — Список сессий\n' +
      '/campaigns — Активные кампании\n' +
      '/pause — Пауза всех рассылок\n' +
      '/resume — Возобновить всё\n' +
      '/connect — Подключить группу\n' +
      '/disconnect — Отключить группу\n' +
      '/logout — Выйти из аккаунта\n\n' +
      '<i>Reply на сообщение в группе → ответ уходит клиенту</i>',
      { parse_mode: 'HTML' }
    )
  })

  // ══════════════════════════════════════════════════════════════════════════
  // Handle operator replies (text, photo, video, voice, document, sticker)
  // ══════════════════════════════════════════════════════════════════════════

  async function handleOperatorReply(ctx) {
    if (!ctx.message?.reply_to_message) return
    if (!groupChatId || ctx.chat.id !== groupChatId) return

    const replyToId = ctx.message.reply_to_message.message_id
    const mapping = messageMap.get(replyToId)
    if (!mapping) return

    const { contactId, channel, sessionPhone } = mapping

    if (!replySenderFn) {
      return ctx.reply('⚠️ Reply sender not registered.', { reply_to_message_id: ctx.message.message_id })
    }

    try {
      const msg = ctx.message

      // Determine what type of content to send
      if (msg.photo) {
        // Photo — get largest resolution
        const photo = msg.photo[msg.photo.length - 1]
        const file = await ctx.api.getFile(photo.file_id)
        const url = `https://api.telegram.org/file/bot${process.env.WADEALER_BOT_TOKEN}/${file.file_path}`
        const caption = msg.caption || ''
        console.log(`[WADealer Bot] Sending photo reply: channel=${channel} session=${sessionPhone}`)
        await replySenderFn(channel, sessionPhone, contactId, caption, { type: 'image', url })
      } else if (msg.video) {
        const file = await ctx.api.getFile(msg.video.file_id)
        const url = `https://api.telegram.org/file/bot${process.env.WADEALER_BOT_TOKEN}/${file.file_path}`
        const caption = msg.caption || ''
        console.log(`[WADealer Bot] Sending video reply: channel=${channel} session=${sessionPhone}`)
        await replySenderFn(channel, sessionPhone, contactId, caption, { type: 'video', url })
      } else if (msg.voice || msg.audio) {
        const audioFile = msg.voice || msg.audio
        const file = await ctx.api.getFile(audioFile.file_id)
        const url = `https://api.telegram.org/file/bot${process.env.WADEALER_BOT_TOKEN}/${file.file_path}`
        console.log(`[WADealer Bot] Sending audio reply: channel=${channel} session=${sessionPhone}`)
        await replySenderFn(channel, sessionPhone, contactId, '', { type: 'audio', url })
      } else if (msg.document) {
        const file = await ctx.api.getFile(msg.document.file_id)
        const url = `https://api.telegram.org/file/bot${process.env.WADEALER_BOT_TOKEN}/${file.file_path}`
        const caption = msg.caption || ''
        console.log(`[WADealer Bot] Sending document reply: channel=${channel} session=${sessionPhone}`)
        await replySenderFn(channel, sessionPhone, contactId, caption, { type: 'document', url, filename: msg.document.file_name })
      } else if (msg.sticker) {
        // Send sticker as image
        const file = await ctx.api.getFile(msg.sticker.file_id)
        const url = `https://api.telegram.org/file/bot${process.env.WADEALER_BOT_TOKEN}/${file.file_path}`
        console.log(`[WADealer Bot] Sending sticker reply: channel=${channel} session=${sessionPhone}`)
        await replySenderFn(channel, sessionPhone, contactId, '', { type: 'sticker', url })
      } else if (msg.text) {
        console.log(`[WADealer Bot] Sending text reply: channel=${channel} session=${sessionPhone} text="${msg.text.slice(0, 50)}"`)
        await replySenderFn(channel, sessionPhone, contactId, msg.text)
      } else {
        return ctx.reply('⚠️ Этот тип сообщения не поддерживается для пересылки.', { reply_to_message_id: msg.message_id })
      }

      console.log(`[WADealer Bot] Reply sent OK`)
      stats.replied++
      try {
        await ctx.api.setMessageReaction(ctx.chat.id, msg.message_id, [{ type: 'emoji', emoji: '✅' }])
      } catch {}
    } catch (err) {
      console.error(`[WADealer Bot] Reply send failed: ${err.message}`)
      await ctx.reply(`❌ Ошибка: ${err.message}`, { reply_to_message_id: ctx.message.message_id })
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Login flow handler — email/password in private chat
  // ══════════════════════════════════════════════════════════════════════════

  async function handleLoginFlow(ctx, next) {
    // Only in private chat, only text messages
    if (ctx.chat?.type !== 'private' || !ctx.message?.text) return next()

    const tgUserId = ctx.from?.id
    const pending = pendingLogin.get(tgUserId)
    if (!pending) return next()

    const text = ctx.message.text.trim()

    // Step 1: waiting for email
    if (pending.step === 'email') {
      // Basic email validation
      if (!text.includes('@') || !text.includes('.')) {
        return ctx.reply('❌ Некорректный email. Попробуйте ещё раз:')
      }
      pending.email = text.toLowerCase()
      pending.step = 'password'
      pendingLogin.set(tgUserId, pending)
      return ctx.reply(
        `📧 Email: <code>${esc(pending.email)}</code>\n\n` +
        `🔑 Теперь введите ваш <b>пароль</b>:`,
        { parse_mode: 'HTML' }
      )
    }

    // Step 2: waiting for password
    if (pending.step === 'password') {
      const password = text

      // Delete the password message for security
      try { await ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id) } catch {}

      try {
        // Look up user by email
        const { dbFindUserByEmail } = await import('./db.js')
        const { getUserTeam } = await import('./auth-helpers.js')

        const user = await dbFindUserByEmail(pending.email)
        if (!user || !user.password_hash) {
          pendingLogin.delete(tgUserId)
          return ctx.reply(
            '❌ Пользователь не найден или не зарегистрирован.\n\n' +
            'Сначала зарегистрируйтесь на https://wadealer.business\n' +
            'Затем используйте /start для привязки.'
          )
        }

        const valid = await bcrypt.compare(password, user.password_hash)
        if (!valid) {
          pendingLogin.delete(tgUserId)
          return ctx.reply(
            '❌ Неверный пароль.\n\n' +
            'Используйте /start чтобы попробовать снова.'
          )
        }

        // Auth successful — get team info
        const teamInfo = await getUserTeam(user.id)

        const authData = {
          userId: user.id,
          teamId: teamInfo?.team_id || null,
          email: user.email,
          isAdmin: user.is_admin || false,
          displayName: user.display_name || user.email.split('@')[0],
        }

        authedUsers.set(tgUserId, authData)
        pendingLogin.delete(tgUserId)

        console.log(`[WADealer Bot] User authed: tg=${tgUserId} → ${user.email} (admin=${user.is_admin})`)

        const { waOnline, tgOnline } = getSessionsInfo(authData)
        return ctx.reply(
          `✅ <b>Авторизация успешна!</b>\n\n` +
          `👤 ${esc(authData.displayName)} (${esc(user.email)})\n` +
          (authData.isAdmin ? '👑 Администратор\n' : '') +
          `\n📱 WA сессий: <b>${waOnline}</b>\n` +
          `✈️ TG аккаунтов: <b>${tgOnline}</b>\n\n` +
          `Выберите действие:`,
          { parse_mode: 'HTML', reply_markup: mainMenuKeyboard() }
        )
      } catch (err) {
        console.error(`[WADealer Bot] Login error: ${err.message}`)
        pendingLogin.delete(tgUserId)
        return ctx.reply(`❌ Ошибка авторизации: ${err.message}\n\nИспользуйте /start чтобы попробовать снова.`)
      }
    }

    return next()
  }

  // Register login flow BEFORE operator reply handler
  botInstance.on('message', handleLoginFlow)

  // Listen to ALL message types in the group
  botInstance.on('message', handleOperatorReply)
}

// ─── Start bot ───────────────────────────────────────────────────────────────

export async function startWaDealerBot(orchestrator = null) {
  const token = process.env.WADEALER_BOT_TOKEN
  if (!token) {
    console.warn('[WADealer Bot] WADEALER_BOT_TOKEN not set — bot disabled')
    return null
  }

  _orchestrator = orchestrator
  _db = orchestrator?.db || null

  const config = loadConfig()
  if (config.groupChatId) {
    groupChatId = config.groupChatId
    console.log(`[WADealer Bot] Loaded operator group: ${groupChatId}`)
  }
  if (!groupChatId && process.env.WADEALER_GROUP_ID) {
    groupChatId = parseInt(process.env.WADEALER_GROUP_ID)
    console.log(`[WADealer Bot] Using group from env: ${groupChatId}`)
  }

  bot = new Bot(token)
  setupBot(bot)
  stats.startedAt = Date.now()

  // Update commands list in Telegram
  try {
    await bot.api.setMyCommands([
      { command: 'start', description: 'Главное меню' },
      { command: 'stats', description: 'Статистика' },
      { command: 'sessions', description: 'Список сессий' },
      { command: 'campaigns', description: 'Кампании' },
      { command: 'pause', description: 'Пауза всех рассылок' },
      { command: 'resume', description: 'Возобновить рассылку' },
      { command: 'help', description: 'Помощь' },
      { command: 'logout', description: 'Выйти из аккаунта' },
    ])
  } catch {}

  bot.start({
    onStart: async () => {
      console.log(`[WADealer Bot] Bot started (polling)`)
      if (groupChatId) {
        try {
          await bot.api.sendMessage(groupChatId, '🟢 <b>WADealer Bot перезапущен</b>. Готов к работе.', { parse_mode: 'HTML' })
        } catch {}
      }
    },
  }).catch((err) => {
    console.error(`[WADealer Bot] Polling error: ${err.message}`)
  })

  return bot
}

export async function stopWaDealerBot() {
  if (bot) {
    try { bot.stop() } catch {}
    bot = null
  }
  messageMap.destroy()
  console.log('[WADealer Bot] Bot stopped')
}
