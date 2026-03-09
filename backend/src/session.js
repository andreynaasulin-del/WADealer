import fs from 'fs'
import path from 'path'
import { EventEmitter } from 'events'
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  downloadMediaMessage,
} from '@whiskeysockets/baileys'
import { HttpsProxyAgent } from 'https-proxy-agent'
import QRCode from 'qrcode'
import pino from 'pino'
import { humanTypingDuration } from './human-delay.js'
import 'dotenv/config'

const SESSIONS_DIR = process.env.SESSIONS_DIR || './sessions'
const SILENT_LOGGER = pino({ level: 'silent' })

// ─── Cached Baileys version (fetched once, reused) ───────────────────────────
let _cachedVersion = null
let _versionFetchedAt = 0
const VERSION_CACHE_TTL = 6 * 60 * 60 * 1000 // 6 hours

async function getCachedVersion() {
  if (_cachedVersion && Date.now() - _versionFetchedAt < VERSION_CACHE_TTL) {
    return _cachedVersion
  }
  try {
    const { version } = await fetchLatestBaileysVersion()
    _cachedVersion = version
    _versionFetchedAt = Date.now()
    return version
  } catch {
    // If fetch fails, use cached or fallback
    return _cachedVersion || [2, 3000, 1015901307]
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildProxyUrl(proxyString) {
  if (proxyString.startsWith('http')) return proxyString
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
    this.id = null
    this.phone = phone
    this.proxyString = proxyString
    this.orchestrator = orchestrator
    this.status = 'offline'
    this.qrCode = null
    this.sock = null
    this.saveCreds = null
    this.stopped = false
    this.connectedAt = null
    this.reconnectAttempts = 0
    this._reconnectTimer = null
    this._keepaliveTimer = null
    this._connectTimeoutTimer = null  // NEW: timeout if connect takes too long
    this._401retried = false
    this._startLock = false           // NEW: prevent concurrent start() calls
    this._lastStartAt = 0            // NEW: track when last start() was called

    /** @type {Map<string, string>} lid number → real phone */
    this._lidToPhone = new Map()
  }

  // ── Cleanup old socket safely ──────────────────────────────────────────────
  _cleanup() {
    clearTimeout(this._reconnectTimer)
    this._reconnectTimer = null
    clearInterval(this._keepaliveTimer)
    this._keepaliveTimer = null
    clearTimeout(this._connectTimeoutTimer)
    this._connectTimeoutTimer = null

    if (this.sock) {
      try {
        this.sock.ev.removeAllListeners()
        this.sock.end(undefined)
      } catch (_) {}
      this.sock = null
    }
  }

  _scheduleReconnect(reason, code) {
    if (this.stopped) return
    // Exponential backoff: 3s → 6s → 12s → 24s → 48s → 60s (cap)
    const delay = Math.min(3_000 * Math.pow(2, this.reconnectAttempts), 60_000)
    this.reconnectAttempts++

    // After 20 consecutive failures — reset backoff (maybe transient issue resolved)
    if (this.reconnectAttempts > 20) {
      this.reconnectAttempts = 0
    }

    this.log(`Авто-реконнект через ${Math.round(delay / 1000)}с (попытка ${this.reconnectAttempts}, причина: ${reason}, код: ${code})`, 'warn')
    this.status = 'reconnecting'
    this.orchestrator.broadcast({ type: 'session_update', phone: this.phone, status: 'reconnecting', qrCode: this.qrCode })

    clearTimeout(this._reconnectTimer)
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null
      if (!this.stopped) this.start()
    }, delay)
  }

  log(message, level = 'info') {
    this.orchestrator.log(this.phone, message, level)
  }

  async start() {
    if (this.stopped) return
    if (this._startLock) {
      this.log('start() уже выполняется, пропускаем дубль', 'warn')
      return
    }

    this._startLock = true
    this._lastStartAt = Date.now()

    try {
      // ── STEP 1: Clean up old socket (CRITICAL — prevents ghost connections) ──
      this._cleanup()

      const sessionDir = path.resolve(SESSIONS_DIR, this.phone.replace(/\+/g, ''))
      const { state, saveCreds } = await useMultiFileAuthState(sessionDir)
      this.saveCreds = saveCreds

      // ── STEP 2: Proxy agent (optional — disabled if PROXY_DISABLED=true or proxy dead) ──
      let agent = undefined
      let connectionLabel = 'DIRECT (без прокси)'
      const proxyDisabled = process.env.PROXY_DISABLED === 'true' || process.env.PROXY_DISABLED === '1'

      if (this.proxyString && !proxyDisabled) {
        try {
          const proxyUrl = buildProxyUrl(this.proxyString)
          const proxyHost = this.proxyString.split(':')[0]
          const proxyPort = this.proxyString.split(':')[1]

          // Real proxy health check via https module
          const https = await import('https')
          const testAgent = new HttpsProxyAgent(proxyUrl)
          const proxyAlive = await new Promise((resolve) => {
            const timer = setTimeout(() => resolve(false), 5000)
            const req = https.default.get('https://web.whatsapp.com', { agent: testAgent, timeout: 4000 }, (res) => {
              clearTimeout(timer)
              resolve(res.statusCode > 0)
            })
            req.on('error', () => { clearTimeout(timer); resolve(false) })
            req.on('timeout', () => { req.destroy(); clearTimeout(timer); resolve(false) })
          })

          if (proxyAlive) {
            agent = new HttpsProxyAgent(proxyUrl)
            connectionLabel = `прокси ${proxyHost}:${proxyPort}`
          } else {
            this.log(`⚠ Прокси ${proxyHost}:${proxyPort} мёртв — подключение НАПРЯМУЮ`, 'warn')
          }
        } catch (err) {
          this.log(`⚠ Прокси ошибка: ${err.message} — подключение НАПРЯМУЮ`, 'warn')
        }
      } else if (proxyDisabled) {
        this.log(`Прокси отключен (PROXY_DISABLED)`)
      }

      // ── STEP 3: Baileys version (cached, never crashes) ──
      const version = await getCachedVersion()

      this.status = 'initializing'
      this.orchestrator.broadcast({ type: 'session_update', phone: this.phone, status: this.status })
      this.log(`Подключение через ${connectionLabel}...`)

      // ── STEP 4: Create socket ──
      const socketOpts = {
        version,
        auth: state,
        browser: Browsers.macOS('Desktop'),
        printQRInTerminal: false,
        logger: SILENT_LOGGER,
        syncFullHistory: false,
        markOnlineOnConnect: false,
        connectTimeoutMs: 60_000,
        defaultQueryTimeoutMs: 60_000,
        retryRequestDelayMs: 3_000,
        keepAliveIntervalMs: 25_000,
        emitOwnEvents: true,
      }
      // Only add proxy if alive
      if (agent) {
        socketOpts.agent = agent
        socketOpts.fetchAgent = agent
      }
      this.sock = makeWASocket(socketOpts)

      // ── STEP 5: Connect timeout — if not online in 90s, force reconnect ──
      this._connectTimeoutTimer = setTimeout(() => {
        this._connectTimeoutTimer = null
        if (this.status !== 'online' && this.status !== 'qr_pending' && this.status !== 'pairing_pending') {
          this.log(`⏱ Таймаут подключения (90с) — принудительный реконнект`, 'warn')
          this._cleanup()
          this._startLock = false
          this._scheduleReconnect('connect_timeout', 0)
        }
      }, 90_000)

      // ── EVENTS ────────────────────────────────────────────────────────────

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update

        // New QR
        if (qr) {
          clearTimeout(this._connectTimeoutTimer) // don't timeout while waiting for QR
          this._connectTimeoutTimer = null
          try {
            const newQr = await QRCode.toDataURL(qr)
            if (newQr !== this.qrCode) {
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
          clearTimeout(this._connectTimeoutTimer)
          this._connectTimeoutTimer = null
          this.status = 'online'
          this.qrCode = null
          this.connectedAt = new Date().toISOString()
          this.reconnectAttempts = 0
          this._401retried = false
          this.log(`✅ Подключено (${connectionLabel})`)
          this.orchestrator.broadcast({ type: 'session_update', phone: this.phone, status: 'online', qrCode: null })
          await this.orchestrator.db.dbUpdateSessionStatus(this.phone, 'online')

          // ── Keepalive: presence каждые 90 сек + WS health check ──
          clearInterval(this._keepaliveTimer)
          this._keepaliveTimer = setInterval(async () => {
            try {
              if (!this.sock || this.status !== 'online') return

              // Check WebSocket is alive
              const ws = this.sock?.ws
              if (ws && typeof ws.readyState === 'number' && ws.readyState !== 1) {
                this.log(`⚠ WebSocket dead (state=${ws.readyState}), реконнект...`, 'warn')
                this._startLock = false
                this._scheduleReconnect('ws_dead', ws.readyState)
                return
              }

              await this.sock.sendPresenceUpdate('available')
            } catch (err) {
              this.log(`Keepalive: ${err.message}`, 'warn')
              // If presence fails, connection is probably dead
              if (err.message?.includes('closed') || err.message?.includes('not open')) {
                this._startLock = false
                this._scheduleReconnect('keepalive_fail', err.message)
              }
            }
          }, 90_000) // 90 seconds
        }

        if (connection === 'close') {
          clearTimeout(this._connectTimeoutTimer)
          this._connectTimeoutTimer = null
          clearInterval(this._keepaliveTimer)
          this._keepaliveTimer = null
          this._startLock = false

          const code = lastDisconnect?.error?.output?.statusCode
          const reason = lastDisconnect?.error?.message || 'unknown'

          if (code === DisconnectReason.loggedOut || code === 401) {
            if (!this._401retried) {
              // 401 часто бывает ложным — пробуем 1 раз
              this._401retried = true
              this.log(`401 — пробуем переподключиться...`, 'warn')
              this._scheduleReconnect('401_first', code)
            } else {
              // Повторный 401 — реально разлогинен — удаляем credentials и перезапускаем с QR
              this._401retried = false
              this.reconnectAttempts = 0
              this.log(`Повторный 401 — удаляю credentials, перезапуск для нового QR...`, 'warn')

              // Удалить старые credentials чтобы при рестарте получить новый QR
              const sessionDir = path.resolve(SESSIONS_DIR, this.phone.replace(/\+/g, ''))
              try {
                if (fs.existsSync(sessionDir)) {
                  fs.rmSync(sessionDir, { recursive: true, force: true })
                  this.log(`Credentials удалены: ${sessionDir}`)
                }
              } catch (err) {
                this.log(`Ошибка удаления credentials: ${err.message}`, 'error')
              }

              // Рестарт через 3 секунды — без credentials Baileys сгенерирует QR
              this.status = 'reconnecting'
              this.orchestrator.broadcast({ type: 'session_update', phone: this.phone, status: 'reconnecting', qrCode: null })
              await this.orchestrator.db.dbUpdateSessionStatus(this.phone, 'offline')

              clearTimeout(this._reconnectTimer)
              this._reconnectTimer = setTimeout(() => {
                this._reconnectTimer = null
                if (!this.stopped) this.start()
              }, 3_000)
            }

          } else if (code === 403) {
            this.reconnectAttempts = 0
            this.log(`Аккаунт заблокирован WhatsApp (403)`, 'error')
            this.status = 'banned'
            this.qrCode = null
            this.orchestrator.broadcast({ type: 'session_update', phone: this.phone, status: 'banned', qrCode: null })
            await this.orchestrator.db.dbUpdateSessionStatus(this.phone, 'banned')

          } else if (code === 440) {
            // 440 = connectionReplaced — часто ложное, реконнект через 10с
            this.log(`440 connectionReplaced — реконнект через 10с...`, 'warn')
            this._scheduleReconnect('440_replaced', code)

          } else if (code === DisconnectReason.restartRequired || code === 515) {
            this.log(`515 рестарт — реконнект через 2с...`, 'warn')
            clearTimeout(this._reconnectTimer)
            this._reconnectTimer = setTimeout(() => {
              this._reconnectTimer = null
              if (!this.stopped) this.start()
            }, 2_000)

          } else {
            // Всё остальное: timeout, 428, network drop, proxy error — РЕКОННЕКТ
            this.log(`Дисконнект (${code}: ${reason}) — реконнект...`, 'warn')
            this._scheduleReconnect(reason, code)
          }
        }
      })

      this.sock.ev.on('creds.update', saveCreds)

      // ── LID mapping ──
      this.sock.ev.on('contacts.upsert', (contacts) => this._processContacts(contacts))
      this.sock.ev.on('contacts.update', (updates) => this._processContacts(updates))

      // ── Messages ──
      this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return
        for (const msg of messages) {
          try {
            await this._handleMessage(msg)
          } catch (err) {
            this.log(`Ошибка обработки сообщения: ${err.message}`, 'error')
          }
        }
      })

      this._startLock = false

    } catch (err) {
      this._startLock = false
      this.log(`Ошибка start(): ${err.message}`, 'error')

      if (!this.stopped) {
        this._scheduleReconnect('start_crash', err.message)
      } else {
        this.status = 'offline'
        this.orchestrator.broadcast({ type: 'session_update', phone: this.phone, status: 'offline', qrCode: null })
      }
    }
  }

  // ── Handle a single incoming/outgoing message ──────────────────────────────
  async _handleMessage(msg) {
    const rawJid = msg.key.remoteJid || ''
    if (rawJid.includes('@g.us')) return // skip groups

    const rawFrom = rawJid.replace(/@.*$/, '')
    if (!rawFrom) return

    const isLid = rawJid.includes('@lid')
    let from = rawFrom
    if (isLid && this._lidToPhone.has(rawFrom)) {
      from = this._lidToPhone.get(rawFrom)
    }

    // Extract text
    let text = msg.message?.conversation
      || msg.message?.extendedTextMessage?.text
      || ''

    // Media detection
    const mediaTypes = {
      imageMessage:    { emoji: '📷', label: 'Фото',     ext: 'jpg' },
      videoMessage:    { emoji: '🎥', label: 'Видео',    ext: 'mp4' },
      audioMessage:    { emoji: '🎤', label: 'Аудио',    ext: 'ogg' },
      documentMessage: { emoji: '📎', label: 'Документ', ext: 'pdf' },
      stickerMessage:  { emoji: '🏷️', label: 'Стикер',  ext: 'webp' },
    }

    for (const [mType, mInfo] of Object.entries(mediaTypes)) {
      const mediaMsg = msg.message?.[mType]
      if (!mediaMsg) continue
      const caption = mediaMsg.caption || ''
      try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {})
        const ts = Date.now()
        const fname = `${ts}_${from}.${mInfo.ext}`
        const url = await this.orchestrator.db.dbUploadMedia(buffer, fname, mediaMsg.mimetype || `application/octet-stream`)
        text = `[media:${mType.replace('Message', '')}:${url}]`
        if (caption) text += `\n${caption}`
      } catch (err) {
        text = `[${mInfo.emoji} ${mInfo.label}]`
        if (caption) text += `\n${caption}`
        this.log(`Медиа загрузка: ${err.message}`, 'warn')
      }
      break
    }

    if (msg.key.fromMe) {
      if (text) {
        this.orchestrator.storeMessage(this.phone, from, 'outbound', text, msg.key.id)
      }
      return
    }

    // Inbound
    if (text) {
      const lidNote = isLid ? ` (LID: ${rawFrom}${from !== rawFrom ? ' → ' + from : ' ⚠ unresolved'})` : ''
      this.log(`Входящий от ${from}${lidNote}`)
    }
    const unresolvedLid = (isLid && from === rawFrom) ? rawFrom : null
    this.orchestrator.handleReply(from, text, this.phone, unresolvedLid)
  }

  /**
   * Connect via pairing code (8-digit code on phone) instead of QR scan.
   */
  async startWithPairingCode() {
    if (this.status === 'online') throw new Error('Уже онлайн')
    this.stopped = false

    // If socket exists and is in qr_pending/initializing — request code directly
    if (this.sock && (this.status === 'qr_pending' || this.status === 'initializing')) {
      const phoneNum = this.phone.replace(/\+/g, '')
      this.log(`Запрос кода привязки для ${phoneNum}...`)
      try {
        const code = await this.sock.requestPairingCode(phoneNum)
        this.log(`📲 Код привязки: ${code}`, 'warn')
        this.orchestrator.broadcast({ type: 'pairing_code', phone: this.phone, code })
        return code
      } catch (err) {
        this.log(`Ошибка кода: ${err.message}`, 'error')
        throw err
      }
    }

    // Otherwise start fresh session and then request code
    await this.start()
    await new Promise(r => setTimeout(r, 3000))

    if (!this.sock) throw new Error('Сокет не создан')
    const phoneNum = this.phone.replace(/\+/g, '')
    this.log(`Запрос кода привязки для ${phoneNum}...`)
    const code = await this.sock.requestPairingCode(phoneNum)
    this.log(`📲 Код привязки: ${code}`, 'warn')
    this.orchestrator.broadcast({ type: 'pairing_code', phone: this.phone, code })
    return code
  }

  async stop() {
    this.stopped = true
    this.reconnectAttempts = 0
    this._startLock = false
    this._cleanup()
    this.status = 'offline'
    this.log('Сессия остановлена')
    this.orchestrator.broadcast({ type: 'session_update', phone: this.phone, status: 'offline' })
    await this.orchestrator.db.dbUpdateSessionStatus(this.phone, 'offline')
  }

  // ── LID mapping helpers ────────────────────────────────────────────────────

  _processContacts(contacts) {
    let mapped = 0
    for (const c of contacts) {
      const lid = (c.lid || '').replace(/@.*$/, '')
      const phone = (c.id || '').replace(/@.*$/, '')
      if (lid && phone && lid !== phone) {
        this._lidToPhone.set(lid, phone)
        this.orchestrator._lidMap?.set(lid, phone)
        mapped++
      }
    }
    if (mapped > 0) {
      this.log(`📇 ${mapped} LID→Phone маппингов (всего: ${this._lidToPhone.size})`)
    }
  }

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
    this.log(`Печать ${(typingMs / 1000).toFixed(1)}с → ${toPhone}`)
    await sleep(typingMs)
    await this.sock.sendPresenceUpdate('paused', bareJid)
    const result = await this.sock.sendMessage(bareJid, { text })
    this.log(`Отправлено → ${toPhone}`)
    return result
  }
}
