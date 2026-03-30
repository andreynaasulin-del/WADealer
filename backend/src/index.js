import 'dotenv/config'

// ── Prevent unhandled errors from crashing the process ──────────────────────
process.on('unhandledRejection', (reason, promise) => {
  const msg = reason?.message || reason || 'unknown'
  // GramJS noise — don't crash
  if (typeof msg === 'string' && (
    msg.includes('Not connected') ||
    msg.includes('AUTH_KEY_DUPLICATED') ||
    msg.includes('CONNECTION_NOT_INITED') ||
    msg.includes('FLOOD_WAIT') ||
    msg.includes('TIMEOUT') ||
    msg.includes('network')
  )) {
    console.warn(`[GramJS unhandled] ${msg}`)
    return
  }
  console.error('[UNHANDLED REJECTION]', reason)
})

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err.message)
  // Don't exit for GramJS errors
  if (err.message?.includes('Not connected') || err.message?.includes('AUTH_KEY_DUPLICATED')) return
  // For real bugs — exit so PM2 restarts
  process.exit(1)
})

import Fastify from 'fastify'
import corsPlugin from '@fastify/cors'
import wsPlugin from '@fastify/websocket'

import { orchestrator } from './orchestrator.js'
import authRoutes     from './routes/auth.js'
import sessionRoutes  from './routes/sessions.js'
import campaignRoutes from './routes/campaigns.js'
import leadRoutes     from './routes/leads.js'
import statsRoutes    from './routes/stats.js'
import telegramRoutes from './routes/telegram.js'
import crmRoutes      from './routes/crm.js'
import aiChatRoutes   from './routes/ai-chat.js'
import profileRoutes  from './routes/profiles.js'
import teamRoutes     from './routes/teams.js'
import blacklistRoutes from './routes/blacklist.js'
import farmRoutes from './routes/farm.js'
import marketplaceRoutes from './routes/marketplace.js'
import {
  dbValidateAuthSession,
  dbCountInviteTokens,
  dbCreateInviteToken,
  dbCheckAuthTablesExist,
  dbGetUserById,
} from './db.js'
import { getUserTeam } from './auth-helpers.js'
import { startWaDealerBot, setReplySender, stopWaDealerBot } from './wadealer-bot.js'

const PORT   = parseInt(process.env.PORT || '3001', 10)
const ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000'

// ─── Routes that DON'T require authentication ────────────────────────────────
const PUBLIC_ROUTES = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/google',
  '/api/auth/verify',
  '/api/public/profile',
  '/api/teams/join',
  '/health',
]

function isPublicRoute(url) {
  const path = url.split('?')[0]  // strip query params
  return PUBLIC_ROUTES.some(r => path === r || path.startsWith(r + '/'))
}

// ─── Fastify setup ────────────────────────────────────────────────────────────

const app = Fastify({
  logger: {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
    },
  },
})

await app.register(corsPlugin, {
  origin: ORIGIN,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
})

await app.register(wsPlugin)

// ─── Auth middleware ─────────────────────────────────────────────────────────
// Protects all /api/* routes except public ones

let authEnabled = true  // will be set to false if auth tables don't exist

app.addHook('onRequest', async (req, reply) => {
  // Skip auth if tables don't exist yet (first-time setup)
  if (!authEnabled) return

  // Skip non-API routes, public routes, WebSocket upgrade, OPTIONS
  if (!req.url.startsWith('/api/')) return
  if (isPublicRoute(req.url)) return
  if (req.method === 'OPTIONS') return

  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()

  if (!token) {
    return reply.code(401).send({ error: 'Требуется авторизация' })
  }

  const session = await dbValidateAuthSession(token)
  if (!session) {
    return reply.code(401).send({ error: 'Сессия истекла или недействительна' })
  }

  // Attach session to request for downstream use
  req.authSession = session

  // Load user if session has user_id
  if (session.user_id) {
    const user = await dbGetUserById(session.user_id)
    if (user) {
      // Load team membership info
      const teamInfo = await getUserTeam(user.id)
      if (teamInfo) {
        user.team_id = teamInfo.team_id
        user.team_role = teamInfo.role
        user.team_name = teamInfo.team_name
      }
      req.user = user
    }
  }
})

// ─── REST routes ──────────────────────────────────────────────────────────────

await app.register(authRoutes)
await app.register(sessionRoutes)
await app.register(campaignRoutes)
await app.register(leadRoutes)
await app.register(statsRoutes)
await app.register(telegramRoutes)
await app.register(crmRoutes)
await app.register(aiChatRoutes)
await app.register(profileRoutes)
await app.register(teamRoutes)
await app.register(blacklistRoutes)
await app.register(farmRoutes)
await app.register(marketplaceRoutes)

// ─── WebSocket endpoint — live logs & events ─────────────────────────────────
// @fastify/websocket v8 passes a WebSocketStream (Duplex); raw WS is at .socket

app.get('/ws', { websocket: true }, async (connection, req) => {
  // Normalise: v8 = WebSocketStream with .socket; fall back to direct WebSocket
  const ws = connection.socket ?? connection

  // Auth check for WebSocket (token in query string)
  if (authEnabled) {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const token = url.searchParams.get('token')
    if (token) {
      const session = await dbValidateAuthSession(token)
      if (!session) {
        ws.close(4001, 'Unauthorized')
        return
      }
    }
    // If no token provided but auth is enabled, still allow (WS auth is optional for now)
  }

  orchestrator.addWsClient(ws)

  // Send current state snapshot on connect
  const states = orchestrator.getAllSessionStates()
  const tgAccounts = orchestrator.getAllTelegramAccountStates()
  try {
    ws.send(JSON.stringify({
      type: 'init',
      sessions: states,
      telegramAccounts: tgAccounts,
      queue: { status: orchestrator.queue.status, size: orchestrator.queue.size },
      telegramQueue: { status: orchestrator.telegramQueue.status, size: orchestrator.telegramQueue.size },
    }))
  } catch (_) {}

  ws.on('close', () => orchestrator.removeWsClient(ws))
  ws.on('error', () => orchestrator.removeWsClient(ws))
})

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/health', async () => ({ ok: true, uptime: process.uptime() }))

// ─── Error handler ────────────────────────────────────────────────────────────

app.setErrorHandler((err, _req, reply) => {
  app.log.error(err)
  orchestrator.log(null, `API Error: ${err.message}`, 'error')
  reply.code(err.statusCode || 500).send({ error: err.message })
})

// ─── Bootstrap auth ──────────────────────────────────────────────────────────

async function bootstrapAuth() {
  const tablesExist = await dbCheckAuthTablesExist()
  if (!tablesExist) {
    console.warn('\n  ⚠️  Auth tables not found in Supabase!')
    console.warn('  Run the SQL from backend/migrations/001_auth_tables.sql in Supabase Dashboard')
    console.warn('  Auth is DISABLED until tables are created.\n')
    authEnabled = false
    return
  }

  authEnabled = true

  // Auto-generate first invite token if none exist
  const count = await dbCountInviteTokens()
  if (count === 0) {
    try {
      const invite = await dbCreateInviteToken('Auto-generated initial invite')
      console.log('\n  ╔══════════════════════════════════════════════════════════════╗')
      console.log('  ║  FIRST INVITE TOKEN (use this to log in):                  ║')
      console.log(`  ║  ${invite.token}  ║`)
      console.log('  ╚══════════════════════════════════════════════════════════════╝\n')
    } catch (e) {
      console.error('  Failed to create initial invite token:', e.message)
    }
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

try {
  await app.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`\n  ██╗    ██╗ █████╗     ██████╗ ███████╗ █████╗ ██╗     ███████╗██████╗`)
  console.log(`  ██║    ██║██╔══██╗    ██╔══██╗██╔════╝██╔══██╗██║     ██╔════╝██╔══██╗`)
  console.log(`  ██║ █╗ ██║███████║    ██║  ██║█████╗  ███████║██║     █████╗  ██████╔╝`)
  console.log(`  ██║███╗██║██╔══██║    ██║  ██║██╔══╝  ██╔══██║██║     ██╔══╝  ██╔══██╗`)
  console.log(`  ╚███╔███╔╝██║  ██║    ██████╔╝███████╗██║  ██║███████╗███████╗██║  ██║`)
  console.log(`   ╚══╝╚══╝ ╚═╝  ╚═╝    ╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝╚══════╝╚═╝  ╚═╝\n`)
  console.log(`  Backend running on http://0.0.0.0:${PORT}`)
  console.log(`  WebSocket on ws://0.0.0.0:${PORT}/ws\n`)

  // Bootstrap auth system
  await bootstrapAuth()

  // Restore persisted sessions from DB
  await orchestrator.restoreFromDB()

  // Start WADealer operator bot
  startWaDealerBot(orchestrator)
  setReplySender(async (channel, sessionPhone, contactId, text, media) => {
    console.log(`[Reply] channel=${channel} session=${sessionPhone} contact=${contactId} text="${(text || '').slice(0, 30)}" media=${media?.type || 'none'}`)

    if (channel === 'whatsapp') {
      const session = orchestrator.sessions.get(sessionPhone)
      if (!session || !session.sock) throw new Error(`WA session ${sessionPhone} not found or offline`)

      const jid = contactId.includes('@') ? contactId : `${contactId}@s.whatsapp.net`

      if (media) {
        // Download media from TG bot file URL
        const https = await import('https')
        const http = await import('http')
        const fetchMedia = (url) => new Promise((resolve, reject) => {
          const mod = url.startsWith('https') ? https.default : http.default
          mod.get(url, (res) => {
            const chunks = []
            res.on('data', c => chunks.push(c))
            res.on('end', () => resolve(Buffer.concat(chunks)))
            res.on('error', reject)
          }).on('error', reject)
        })

        const buffer = await fetchMedia(media.url)

        if (media.type === 'image' || media.type === 'sticker') {
          await session.sock.sendMessage(jid, { image: buffer, caption: text || undefined })
        } else if (media.type === 'video') {
          await session.sock.sendMessage(jid, { video: buffer, caption: text || undefined })
        } else if (media.type === 'audio') {
          await session.sock.sendMessage(jid, { audio: buffer, ptt: true })
        } else if (media.type === 'document') {
          await session.sock.sendMessage(jid, { document: buffer, fileName: media.filename || 'file', caption: text || undefined })
        }
      } else {
        await session.sock.sendMessage(jid, { text })
      }

      const phone = contactId.replace(/@.*$/, '')
      orchestrator.storeMessage(sessionPhone, phone, 'outbound', text || `[${media?.type || 'media'}]`)
      console.log(`[Reply] Sent via WA session ${sessionPhone} to ${jid}`)

    } else if (channel === 'telegram') {
      const acc = orchestrator.telegramAccounts.get(sessionPhone)
      if (!acc || !acc.client) throw new Error(`TG account ${sessionPhone} not found`)
      // GramJS needs numeric ID
      const tgContactId = /^\d+$/.test(contactId) ? parseInt(contactId) : contactId

      if (media) {
        // For TG, send file directly
        const { Api } = await import('telegram')
        const https = await import('https')
        const http = await import('http')
        const fetchMedia = (url) => new Promise((resolve, reject) => {
          const mod = url.startsWith('https') ? https.default : http.default
          mod.get(url, (res) => {
            const chunks = []
            res.on('data', c => chunks.push(c))
            res.on('end', () => resolve(Buffer.concat(chunks)))
            res.on('error', reject)
          }).on('error', reject)
        })

        const buffer = await fetchMedia(media.url)
        await acc.client.sendFile(tgContactId, {
          file: buffer,
          caption: text || undefined,
          forceDocument: media.type === 'document',
          voiceNote: media.type === 'audio',
        })
      } else {
        await acc.client.sendMessage(tgContactId, { message: text })
      }
      console.log(`[Reply] Sent via TG account ${sessionPhone} to ${tgContactId}`)
    }
  })
} catch (err) {
  console.error(err)
  process.exit(1)
}

// ── Graceful shutdown — disconnect TG sessions cleanly before PM2 restart ──
async function gracefulShutdown(signal) {
  console.log(`\n[SHUTDOWN] ${signal} received, disconnecting...`)
  try {
    stopWaDealerBot()
    for (const acc of orchestrator.telegramAccounts.values()) {
      if (acc.client) {
        try { await acc.client.disconnect() } catch {}
      }
    }
    for (const sess of orchestrator.sessions.values()) {
      if (sess.sock) {
        try { sess.sock.end() } catch {}
      }
    }
  } catch {}
  console.log('[SHUTDOWN] Clean exit')
  process.exit(0)
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'))
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
