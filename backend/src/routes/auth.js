import bcrypt from 'bcrypt'
import { createClient } from '@supabase/supabase-js'
import {
  dbValidateInviteToken,
  dbUseInviteToken,
  dbCreateAuthSession,
  dbValidateAuthSession,
  dbDeleteAuthSession,
  dbCreateInviteToken,
  dbGetAllInviteTokens,
  dbDeleteInviteToken,
  dbFindUserByEmail,
  dbCreateUser,
  dbGetUserById,
  dbGetAdminUser,
  dbCreateTeam,
  dbAddTeamMember,
  dbGetUserTeam,
  dbCreateBetaInvite,
  dbValidateBetaInvite,
  dbUseBetaInvite,
  dbGetAllBetaInvites,
} from '../db.js'

// ─── Helper: ensure user has a team ─────────────────────────────────────────
async function ensureUserTeam(user) {
  const existing = await dbGetUserTeam(user.id)
  if (existing) return existing

  // Create personal team
  const teamName = user.display_name || user.email.split('@')[0]
  const team = await dbCreateTeam(`Team ${teamName}`, user.id)
  await dbAddTeamMember(team.id, user.id, 'admin')
  return { team_id: team.id, role: 'admin', team_name: team.name }
}

const BCRYPT_ROUNDS = 12

// Supabase client for verifying OAuth tokens (uses service role which can call auth.getUser)
const supabaseAuth = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
)

export default async function authRoutes(fastify) {
  // ── POST /api/auth/register — create account with email/password ────────────
  fastify.post('/api/auth/register', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email:        { type: 'string', minLength: 3 },
          password:     { type: 'string', minLength: 6 },
          display_name: { type: 'string' },
          invite_code:  { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { email, password, display_name, invite_code } = req.body

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply.code(400).send({ error: 'Некорректный email' })
    }

    // Check if user already exists
    const existing = await dbFindUserByEmail(email)
    if (existing) {
      return reply.code(409).send({ error: 'Пользователь с таким email уже существует' })
    }

    // BETA MODE: require invite code for registration
    let tier = 'start'
    if (invite_code) {
      // Try beta invite first
      const betaInvite = await dbValidateBetaInvite(invite_code.trim())
      if (betaInvite) {
        await dbUseBetaInvite(betaInvite.id)
        tier = 'pro'
      } else {
        // Fallback: legacy invite tokens
        const legacyInvite = await dbValidateInviteToken(invite_code.trim())
        if (legacyInvite) {
          await dbUseInviteToken(legacyInvite.id)
          tier = 'pro'
        } else {
          return reply.code(400).send({ error: 'Недействительный invite-код' })
        }
      }
    } else {
      // No invite code — check if beta mode is on
      const betaMode = process.env.BETA_MODE !== 'false' // default: beta ON
      if (betaMode) {
        return reply.code(403).send({ error: 'Регистрация доступна только по invite-коду. Запросите код у администратора.' })
      }
    }

    // Hash password and create user
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
    const user = await dbCreateUser(email, passwordHash, display_name, tier)

    // Auto-create team for new user
    const teamInfo = await ensureUserTeam(user)

    // Create session linked to user
    const session = await dbCreateAuthSession(null, user.id)

    return reply.code(201).send({
      ok: true,
      session_token: session.token,
      expires_at: session.expires_at,
      user: {
        id: user.id, email: user.email, display_name: user.display_name,
        tier: user.tier, is_admin: user.is_admin,
        team_id: teamInfo.team_id, team_role: teamInfo.role, team_name: teamInfo.team_name,
      },
    })
  })

  // ── POST /api/auth/login — email/password OR invite token ───────────────────
  fastify.post('/api/auth/login', {
    schema: {
      body: {
        type: 'object',
        properties: {
          token:    { type: 'string' },
          email:    { type: 'string' },
          password: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { email, password, token } = req.body

    // ── Branch A: Email + Password login ─────────────────────────────────────
    if (email && password) {
      const user = await dbFindUserByEmail(email)
      if (!user || !user.password_hash) {
        return reply.code(401).send({ error: 'Неверный email или пароль' })
      }

      const valid = await bcrypt.compare(password, user.password_hash)
      if (!valid) {
        return reply.code(401).send({ error: 'Неверный email или пароль' })
      }

      // Ensure team exists
      const teamInfo = await ensureUserTeam(user)

      const session = await dbCreateAuthSession(null, user.id)
      return reply.send({
        ok: true,
        session_token: session.token,
        expires_at: session.expires_at,
        user: {
          id: user.id, email: user.email, display_name: user.display_name,
          tier: user.tier, is_admin: user.is_admin,
          team_id: teamInfo.team_id, team_role: teamInfo.role, team_name: teamInfo.team_name,
        },
      })
    }

    // ── Branch B: Invite token / admin secret (legacy flow) ──────────────────
    if (!token) {
      return reply.code(400).send({ error: 'Укажите email+password или invite-токен' })
    }

    let cleanToken = token
    const urlMatch = cleanToken.match(/\/invite\/([^/?&#\s]+)$/)
    if (urlMatch) cleanToken = urlMatch[1]
    cleanToken = cleanToken.trim()

    // Master admin secret
    const adminSecret = process.env.ADMIN_SECRET
    if (adminSecret && cleanToken === adminSecret) {
      const adminUser = await dbGetAdminUser()
      const session = await dbCreateAuthSession(null, adminUser?.id || null)
      return reply.send({ ok: true, session_token: session.token, expires_at: session.expires_at })
    }

    // Normal invite token
    const invite = await dbValidateInviteToken(cleanToken)
    if (!invite) {
      return reply.code(401).send({ error: 'Недействительная или использованная ссылка-приглашение' })
    }

    await dbUseInviteToken(invite.id)
    const session = await dbCreateAuthSession(invite.id)

    return reply.send({
      ok: true,
      session_token: session.token,
      expires_at: session.expires_at,
    })
  })

  // ── POST /api/auth/google — Google OAuth via Supabase Auth ───────────────────
  fastify.post('/api/auth/google', {
    schema: {
      body: {
        type: 'object',
        required: ['access_token'],
        properties: {
          access_token: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (req, reply) => {
    const { access_token } = req.body

    // Verify the Supabase access token and get user info
    const { data: { user: googleUser }, error: authError } = await supabaseAuth.auth.getUser(access_token)

    if (authError || !googleUser) {
      return reply.code(401).send({ error: 'Не удалось верифицировать Google аккаунт' })
    }

    const email = googleUser.email
    if (!email) {
      return reply.code(400).send({ error: 'Google аккаунт без email' })
    }

    const displayName = googleUser.user_metadata?.full_name
      || googleUser.user_metadata?.name
      || email.split('@')[0]

    // Find or create user in our system
    let user = await dbFindUserByEmail(email)

    if (!user) {
      // New user from Google — create with no password (Google-only)
      user = await dbCreateUser(email, null, displayName, 'start')
    }

    // Ensure team exists
    const teamInfo = await ensureUserTeam(user)

    // Create our custom session
    const session = await dbCreateAuthSession(null, user.id)

    return reply.send({
      ok: true,
      session_token: session.token,
      expires_at: session.expires_at,
      user: {
        id: user.id, email: user.email, display_name: user.display_name,
        tier: user.tier, is_admin: user.is_admin,
        team_id: teamInfo.team_id, team_role: teamInfo.role, team_name: teamInfo.team_name,
      },
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

  // ── GET /api/auth/me — get current user profile (protected) ────────────────
  fastify.get('/api/auth/me', async (req, reply) => {
    if (!req.user) {
      return reply.code(401).send({ error: 'Не авторизован' })
    }
    return reply.send({
      id: req.user.id,
      email: req.user.email,
      display_name: req.user.display_name,
      tier: req.user.tier,
      is_admin: req.user.is_admin,
      role: req.user.role || (req.user.is_admin ? 'admin' : 'operator'),
      team_id: req.user.team_id || null,
      team_role: req.user.team_role || null,
      team_name: req.user.team_name || null,
    })
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

  // ── POST /api/auth/beta-invite — generate beta invite code (admin only) ────
  fastify.post('/api/auth/beta-invite', async (req, reply) => {
    if (!req.user?.is_admin) {
      return reply.code(403).send({ error: 'Только для администраторов' })
    }
    const label = req.body?.label || null
    const invite = await dbCreateBetaInvite(req.user.id, label)
    return reply.send({ ok: true, invite_code: invite.token, expires_at: invite.expires_at })
  })

  // ── GET /api/auth/beta-invites — list all beta invites (admin only) ────────
  fastify.get('/api/auth/beta-invites', async (req, reply) => {
    if (!req.user?.is_admin) {
      return reply.code(403).send({ error: 'Только для администраторов' })
    }
    const invites = await dbGetAllBetaInvites()
    return reply.send(invites)
  })
}
