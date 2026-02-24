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
          this.log(`Подключено ✓ (прокси ${proxyHost}:${proxyPort})`)
          this.orchestrator.broadcast({ type: 'session_update', phone: this.phone, status: 'online', qrCode: null })
          await this.orchestrator.db.dbUpdateSessionStatus(this.phone, 'online')
        }

        if (connection === 'close') {
          const code = lastDisconnect?.error?.output?.statusCode
          const reason = lastDisconnect?.error?.message || 'unknown'

          if (code === DisconnectReason.loggedOut || code === 401) {
            // 401 = разлогинен — удаляем битые credentials, нужен новый QR
            const sessionDir = path.resolve(SESSIONS_DIR, this.phone.replace(/\+/g, ''))
            try { fs.rmSync(sessionDir, { recursive: true, force: true }) } catch (_) {}
            this.reconnectAttempts = 0
            this.log(`Разлогинен (код ${code}) — credentials очищены, нажми Подключить для нового QR`, 'warn')
            this.status = 'offline'
            this.orchestrator.broadcast({ type: 'session_update', phone: this.phone, status: 'offline' })
            await this.orchestrator.db.dbUpdateSessionStatus(this.phone, 'offline')

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
            await this.orchestrator.db.dbUpdateSessionStatus(this.phone, 'offline')
            this._scheduleReconnect(reason, code)
          }
        }
      })

      this.sock.ev.on('creds.update', saveCreds)

      // Track messages → store for CRM + AI classification
      this.sock.ev.on('messages.upsert', ({ messages, type }) => {
        if (type !== 'notify') return
        for (const msg of messages) {
          const from = msg.key.remoteJid?.replace('@s.whatsapp.net', '')
          if (!from || from.includes('@g.us')) continue  // skip groups

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
            this.log(`Входящий ответ от ${from}`)
          }
          this.orchestrator.handleReply(from, text, this.phone)
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
    this.status = 'offline'
    try { await this.sock?.end() } catch (_) {}
    this.log('Сессия остановлена')
    this.orchestrator.broadcast({ type: 'session_update', phone: this.phone, status: 'offline' })
    await this.orchestrator.db.dbUpdateSessionStatus(this.phone, 'offline')
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
