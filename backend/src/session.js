import fs from 'fs'
import path from 'path'
import { EventEmitter } from 'events'
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} from '@whiskeysockets/baileys'
import { HttpsProxyAgent } from 'https-proxy-agent'
import QRCode from 'qrcode'
import pino from 'pino'
import { humanTypingDuration } from './human-delay.js'
import 'dotenv/config'

const SESSIONS_DIR = process.env.SESSIONS_DIR || './sessions'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildProxyUrl(proxyString) {
  // Already a full URL
  if (proxyString.startsWith('http')) return proxyString
  // ip:port:user:pass  →  http://user:pass@ip:port
  const parts = proxyString.split(':')
  if (parts.length === 4) {
    const [host, port, user, pass] = parts
    return `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`
  }
  if (parts.length === 2) {
    return `http://${parts[0]}:${parts[1]}`
  }
  throw new Error(`Invalid proxy format: ${proxyString} — expected ip:port:user:pass`)
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function normalizePhone(phone) {
  return phone.replace(/\D/g, '')
}

// ─── Session class ────────────────────────────────────────────────────────────

export class Session extends EventEmitter {
  constructor(phone, proxyString, orchestrator) {
    super()
    this.id = null             // UUID from Supabase, set after DB upsert/restore
    this.phone = phone
    this.proxyString = proxyString
    this.orchestrator = orchestrator
    this.status = 'offline'   // starts offline, connects only on manual trigger
    this.qrCode = null
    this.sock = null
    this.saveCreds = null
    this.stopped = false
    this.connectedAt = null    // ISO timestamp when session went online
    this.reconnectAttempts = 0 // for exponential backoff
    this._reconnectTimer = null
    this._keepaliveTimer = null
    this._401retried = false   // flag: did we already retry after 401?

    // ── LID → Phone mapping (WhatsApp Linked Devices) ─────────────────────
    // WhatsApp Linked Devices use internal LID numbers for message JIDs.
    // We build a reverse map from Baileys contact events.
    /** @type {Map<string, string>} lid number → real phone */
    this._lidToPhone = new Map()
  }

  _scheduleReconnect(reason, code) {
    if (this.stopped) return
    // Exponential backoff: 5s → 10s → 20s → 40s → 60s (max)
    const delay = Math.min(5_000 * Math.pow(2, this.reconnectAttempts), 60_000)
    this.reconnectAttempts++
    this.log(`Авто-реконнект через ${Math.round(delay / 1000)}с (попытка ${this.reconnectAttempts}, причина: ${reason}, код: ${code})`, 'warn')
    this.status = 'initializing'
    this.orchestrator.broadcast({ type: 'session_update', phone: this.phone, status: 'initializing' })
    clearTimeout(this._reconnectTimer)
    this._reconnectTimer = setTimeout(() => {
      if (!this.stopped) this.start()
    }, delay)
  }

  log(message, level = 'info') {
    this.orchestrator.log(this.phone, message, level)
  }

  async start() {
    if (this.stopped) return
    this.stopped = false  // reset so reconnect works after manual stop

    try {
      const sessionDir = path.resolve(SESSIONS_DIR, this.phone.replace(/\+/g, ''))
      const { state, saveCreds } = await useMultiFileAuthState(sessionDir)
      this.saveCreds = saveCreds

      // HTTP proxy (Froxy Mobile+ is HTTP, not SOCKS5)
      const proxyUrl = buildProxyUrl(this.proxyString)
      const proxyHost = this.proxyString.split(':')[0]
      const proxyPort = this.proxyString.split(':')[1]
      const agent = new HttpsProxyAgent(proxyUrl)

      const { version } = await fetchLatestBaileysVersion()

      this.status = 'initializing'
      this.orchestrator.broadcast({ type: 'session_update', phone: this.phone, status: this.status })
      this.log(`Подключение через прокси ${proxyHost}:${proxyPort}...`)

      const silentLogger = pino({ level: 'silent' })

      this.sock = makeWASocket({
        version,
        auth: state,
        agent,
        fetchAgent: agent,
        browser: Browsers.macOS('Desktop'),
        printQRInTerminal: false,
        logger: silentLogger,
        syncFullHistory: false,
        markOnlineOnConnect: false,
        connectTimeoutMs: 30_000,
        defaultQueryTimeoutMs: 30_000,
        retryRequestDelayMs: 2_000,
      })

      // ── Events ──────────────────────────────────────────────────────────────

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update

        // New QR — only log once, don't spam
        if (qr) {
          try {
            const newQr = await QRCode.toDataURL(qr)
            if (newQr !== this.qrCode) {           // only broadcast if QR actually changed
              this.qrCode = newQr
              this.status = 'qr_pending'
              this.log('QR готов — сканируй в WhatsApp → Привязанные устройства', 'warn')
              this.orchestrator.broadcast({ type: 'qr', session: this.phone, qrCode: this.qrCode })
              this.orchestrator.broadcast({ type: 'session_update', phone: this.phone, status: this.status })
            }
          } catch (err) {
            this.log(`Ошибка генерации QR: ${err.message}`, 'error')
          }
        }

        if (connection === 'open') {
          this.status = 'online'
          this.qrCode = null
          this.connectedAt = new Date().toISOString()
          this.reconnectAttempts = 0  // сброс backoff при успешном коннекте
          this._401retried = false    // сброс флага 401
          this.log(`Подключено ✓ (прокси ${proxyHost}:${proxyPort})`)
          this.orchestrator.broadcast({ type: 'session_update', phone: this.phone, status: 'online', qrCode: null })
          await this.orchestrator.db.dbUpdateSessionStatus(this.phone, 'online')

          // ── Keepalive: отправляем presence каждые 4 минуты чтобы WA не отключал ──
          clearInterval(this._keepaliveTimer)
          this._keepaliveTimer = setInterval(async () => {
            try {
              if (this.sock && this.status === 'online') {
                await this.sock.sendPresenceUpdate('available')
              }
            } catch (_) { /* тихо, при следующем цикле разберётся */ }
          }, 4 * 60 * 1000) // каждые 4 минуты
        }

        if (connection === 'close') {
          const code = lastDisconnect?.error?.output?.statusCode
          const reason = lastDisconnect?.error?.message || 'unknown'

          if (code === DisconnectReason.loggedOut || code === 401) {
            // 401 может быть временным — пробуем 1 раз переподключиться
            if (!this._401retried) {
              this._401retried = true
              this.log(`Код 401 — пробуем переподключиться (creds сохранены)...`, 'warn')
              this.status = 'initializing'
              this.orchestrator.broadcast({ type: 'session_update', phone: this.phone, status: 'initializing' })
              clearTimeout(this._reconnectTimer)
              this._reconnectTimer = setTimeout(() => {
                if (!this.stopped) this.start()
              }, 5_000)
            } else {
              // Повторный 401 — реально разлогинен, удаляем credentials
              this._401retried = false
              const sessionDir = path.resolve(SESSIONS_DIR, this.phone.replace(/\+/g, ''))
              try { fs.rmSync(sessionDir, { recursive: true, force: true }) } catch (_) {}
              this.reconnectAttempts = 0
              this.log(`Разлогинен (код ${code}) — credentials очищены, нажми Подключить для нового QR`, 'warn')
              this.status = 'offline'
              this.orchestrator.broadcast({ type: 'session_update', phone: this.phone, status: 'offline' })
              await this.orchestrator.db.dbUpdateSessionStatus(this.phone, 'offline')
            }

          } else if (code === 403) {
            // 403 = заблокирован WhatsApp — не реконнектим
            this.reconnectAttempts = 0
            this.log(`Аккаунт заблокирован WhatsApp (403)`, 'error')
            this.status = 'banned'
            this.orchestrator.broadcast({ type: 'session_update', phone: this.phone, status: 'banned' })
            await this.orchestrator.db.dbUpdateSessionStatus(this.phone, 'banned')

          } else if (code === 440) {
            // 440 = connectionReplaced — вошли с другого устройства
            this.reconnectAttempts = 0
            this.log(`Соединение заменено другим устройством (440) — нажми Подключить`, 'warn')
            this.status = 'offline'
            this.orchestrator.broadcast({ type: 'session_update', phone: this.phone, status: 'offline' })
            await this.orchestrator.db.dbUpdateSessionStatus(this.phone, 'offline')

          } else if (code === DisconnectReason.restartRequired || code === 515) {
            // 515 = штатный перезапуск после QR — реконнект сразу
            this.log(`Перезапуск соединения (код 515 — штатный после QR)...`, 'warn')
            this.status = 'initializing'
            this.orchestrator.broadcast({ type: 'session_update', phone: this.phone, status: 'initializing' })
            clearTimeout(this._reconnectTimer)
            this._reconnectTimer = setTimeout(() => {
              if (!this.stopped) this.start()
            }, 2_000)

          } else {
            // Всё остальное (timeout, network drop, packet loss и т.д.) — авто-реконнект
            // NOTE: НЕ пишем 'offline' в БД — оставляем 'online', чтобы при рестарте PM2
            // restoreFromDB() мог автоматически переподключить сессию.
            // Статус в памяти ставим 'initializing' через _scheduleReconnect.
            this._scheduleReconnect(reason, code)
          }
        }
      })

      this.sock.ev.on('creds.update', saveCreds)

      // ── LID mapping: Baileys contact events ──────────────────────────────
      // WhatsApp Linked Devices use internal LID JIDs. Baileys provides
      // contact updates that map lid ↔ phone number.
      this.sock.ev.on('contacts.upsert', (contacts) => this._processContacts(contacts))
      this.sock.ev.on('contacts.update', (updates) => this._processContacts(updates))

      // Track messages → store for CRM + AI classification
      this.sock.ev.on('messages.upsert', ({ messages, type }) => {
        if (type !== 'notify') return
        for (const msg of messages) {
          const rawJid = msg.key.remoteJid || ''
          if (rawJid.includes('@g.us')) continue  // skip groups

          const rawFrom = rawJid.replace(/@.*$/, '')
          if (!rawFrom) continue

          const isLid = rawJid.includes('@lid')

          // ── Resolve LID → real phone ──────────────────────────────────
          let from = rawFrom
          if (isLid && this._lidToPhone.has(rawFrom)) {
            from = this._lidToPhone.get(rawFrom)
          }

          // Extract text from various message types
          const text = msg.message?.conversation
            || msg.message?.extendedTextMessage?.text
            || ''

          if (msg.key.fromMe) {
            // Outbound sent directly from phone — store for CRM
            if (text) {
              this.orchestrator.storeMessage(this.phone, from, 'outbound', text, msg.key.id)
            }
            continue
          }

          // Inbound message
          if (text) {
            const lidNote = isLid ? ` (LID: ${rawFrom}${from !== rawFrom ? ' → ' + from : ' ⚠ unresolved'})` : ''
            this.log(`Входящий ответ от ${from}${lidNote}`)
          }
          // Pass original LID for orchestrator-level resolution if local map didn't resolve
          const unresolvedLid = (isLid && from === rawFrom) ? rawFrom : null
          this.orchestrator.handleReply(from, text, this.phone, unresolvedLid)
        }
      })

    } catch (err) {
      this.status = 'offline'
      this.log(`Ошибка запуска: ${err.message}`, 'error')
      this.orchestrator.broadcast({ type: 'session_update', phone: this.phone, status: 'offline' })
    }
  }

  async stop() {
    this.stopped = true
    this.reconnectAttempts = 0
    clearTimeout(this._reconnectTimer)
    clearInterval(this._keepaliveTimer)
    this.status = 'offline'
    try { await this.sock?.end() } catch (_) {}
    this.log('Сессия остановлена')
    this.orchestrator.broadcast({ type: 'session_update', phone: this.phone, status: 'offline' })
    await this.orchestrator.db.dbUpdateSessionStatus(this.phone, 'offline')
  }

  // ── LID mapping helpers ──────────────────────────────────────────────────

  /**
   * Process contact updates from Baileys to build LID → phone mapping.
   * Baileys fires contacts.upsert / contacts.update with objects like:
   *   { id: 'phone@s.whatsapp.net', lid: 'lid_number@lid', ... }
   */
  _processContacts(contacts) {
    let mapped = 0
    for (const c of contacts) {
      const lid = (c.lid || '').replace(/@.*$/, '')
      const phone = (c.id || '').replace(/@.*$/, '')
      if (lid && phone && lid !== phone) {
        this._lidToPhone.set(lid, phone)
        // Also update orchestrator's global map
        this.orchestrator._lidMap?.set(lid, phone)
        mapped++
      }
    }
    if (mapped > 0) {
      this.log(`📇 ${mapped} LID→Phone маппингов из контактов (всего: ${this._lidToPhone.size})`)
    }
  }

  /**
   * Resolve a LID number to real phone. Returns null if unknown.
   */
  resolveLid(lid) {
    return this._lidToPhone.get(lid) || null
  }

  async sendMessage(toPhone, text) {
    if (this.status !== 'online' || !this.sock) {
      throw new Error(`Сессия ${this.phone} не в сети`)
    }
    const bareJid = `${normalizePhone(toPhone)}@s.whatsapp.net`
    await this.sock.sendPresenceUpdate('composing', bareJid)
    const typingMs = humanTypingDuration(text.length)
    this.log(`Имитация печати ${(typingMs / 1000).toFixed(1)}с → ${toPhone}`)
    await sleep(typingMs)
    await this.sock.sendPresenceUpdate('paused', bareJid)
    const result = await this.sock.sendMessage(bareJid, { text })
    this.log(`Сообщение отправлено → ${toPhone}`)
    return result
  }
}
