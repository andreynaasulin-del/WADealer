import {
  dbValidateInviteToken,
  dbUseInviteToken,
  dbCreateAuthSession,
  dbValidateAuthSession,
  dbDeleteAuthSession,
  dbCreateInviteToken,
  dbGetAllInviteTokens,
  dbDeleteInviteToken,
} from '../db.js'

export default async function authRoutes(fastify) {
  // ── POST /api/auth/login — redeem invite token, create session ──────────────
  fastify.post('/api/auth/login', {
    schema: {
      body: {
        type: 'object',
        required: ['token'],
        properties: {
          token: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (req, reply) => {
    let { token } = req.body

    // Support pasting a full URL like http://host/invite/TOKEN
    // Regex accepts any URL-safe chars (not just hex) to support admin secret via URL too
    const urlMatch = token.match(/\/invite\/([^/?&#\s]+)$/)
    if (urlMatch) token = urlMatch[1]

    // Trim whitespace
    token = token.trim()

    // ── Master admin secret — eternal, never consumed, not stored in DB ───────
    const adminSecret = process.env.ADMIN_SECRET
    if (adminSecret && token === adminSecret) {
      const session = await dbCreateAuthSession(null)
      return reply.send({ ok: true, session_token: session.token, expires_at: session.expires_at })
    }

    // ── Normal one-time invite token flow ─────────────────────────────────────
    const invite = await dbValidateInviteToken(token)
    if (!invite) {
      return reply.code(401).send({ error: 'Недействительная или использованная ссылка-приглашение' })
    }

    // Mark invite as used
    await dbUseInviteToken(invite.id)

    // Create auth session
    const session = await dbCreateAuthSession(invite.id)

    return reply.send({
      ok: true,
      session_token: session.token,
      expires_at: session.expires_at,
    })
  })

  // ── GET /api/auth/verify — check if current session is valid ────────────────
  fastify.get('/api/auth/verify', async (req, reply) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()

    const session = await dbValidateAuthSession(token)
    if (!session) {
      return reply.code(401).send({ error: 'Не авторизован' })
    }

    return reply.send({ ok: true, expires_at: session.expires_at })
  })

  // ── POST /api/auth/logout — invalidate current session ─────────────────────
  fastify.post('/api/auth/logout', async (req, reply) => {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()

    if (token) {
      try { await dbDeleteAuthSession(token) } catch (_) {}
    }

    return reply.send({ ok: true })
  })

  // ── POST /api/auth/invite — generate new invite token (auth required) ──────
  fastify.post('/api/auth/invite', async (req, reply) => {
    // Auth check (this route is protected by middleware)
    const label = req.body?.label || null
    const invite = await dbCreateInviteToken(label)
    return reply.code(201).send(invite)
  })

  // ── GET /api/auth/invites — list all invite tokens (auth required) ─────────
  fastify.get('/api/auth/invites', async (req, reply) => {
    const invites = await dbGetAllInviteTokens()
    return reply.send(invites)
  })

  // ── DELETE /api/auth/invite/:id — delete an invite token (auth required) ───
  fastify.delete('/api/auth/invite/:id', async (req, reply) => {
    await dbDeleteInviteToken(req.params.id)
    return reply.code(204).send()
  })
}
