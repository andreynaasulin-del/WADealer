import 'dotenv/config'
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
import {
  dbValidateAuthSession,
  dbCountInviteTokens,
  dbCreateInviteToken,
  dbCheckAuthTablesExist,
} from './db.js'

const PORT   = parseInt(process.env.PORT || '3001', 10)
const ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000'

// ─── Routes that DON'T require authentication ────────────────────────────────
const PUBLIC_ROUTES = [
  '/api/auth/login',
  '/api/auth/verify',
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
} catch (err) {
  console.error(err)
  process.exit(1)
}
