import {
  dbGetEmailAccounts,
  dbCreateEmailAccount,
  dbUpdateEmailAccount,
  dbDeleteEmailAccount,
  dbGetEmailCampaigns,
  dbCreateEmailCampaign,
  dbUpdateEmailCampaign,
  dbDeleteEmailCampaign,
  dbGetEmailLeads,
  dbAddEmailLeads,
  dbGetEmailStats,
} from '../db.js'

export default async function emailRoutes(fastify) {
  // ── Helper: get team scope ─────────────────────────────────────────────────
  function teamScope(req) {
    if (req.user?.is_admin) return null  // admin sees all
    return req.user?.team_id || 'no-team'
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Email Accounts
  // ══════════════════════════════════════════════════════════════════════════

  fastify.get('/api/email/accounts', async (req) => {
    return dbGetEmailAccounts(teamScope(req))
  })

  fastify.post('/api/email/accounts', async (req, reply) => {
    const { email, display_name, smtp_host, smtp_port, smtp_user, smtp_pass, imap_host, imap_port, daily_limit } = req.body || {}
    if (!email || !smtp_host || !smtp_user || !smtp_pass) {
      return reply.code(400).send({ error: 'email, smtp_host, smtp_user, smtp_pass обязательны' })
    }
    const account = await dbCreateEmailAccount({
      email, display_name, smtp_host, smtp_port, smtp_user, smtp_pass,
      imap_host, imap_port, daily_limit,
      user_id: req.user?.id, team_id: req.user?.team_id,
    })
    return reply.code(201).send(account)
  })

  fastify.put('/api/email/accounts/:id', async (req, reply) => {
    const { id } = req.params
    const updates = req.body || {}
    delete updates.id
    delete updates.user_id
    delete updates.team_id
    const account = await dbUpdateEmailAccount(id, updates)
    return account
  })

  fastify.delete('/api/email/accounts/:id', async (req, reply) => {
    await dbDeleteEmailAccount(req.params.id)
    return { ok: true }
  })

  // ── Test SMTP connection ─────────────────────────────────────────────────
  fastify.post('/api/email/accounts/:id/test', async (req, reply) => {
    const { id } = req.params
    try {
      const nodemailer = await import('nodemailer')
      const accounts = await dbGetEmailAccounts(teamScope(req))
      const account = accounts.find(a => a.id === id)
      if (!account) return reply.code(404).send({ error: 'Аккаунт не найден' })

      const transporter = nodemailer.default.createTransport({
        host: account.smtp_host,
        port: account.smtp_port,
        secure: account.smtp_port === 465,
        auth: { user: account.smtp_user, pass: account.smtp_pass },
        connectionTimeout: 10000,
      })

      await transporter.verify()
      await dbUpdateEmailAccount(id, { status: 'online', last_error: null })
      return { ok: true, message: 'SMTP подключение успешно' }
    } catch (err) {
      await dbUpdateEmailAccount(id, { status: 'error', last_error: err.message })
      return reply.code(400).send({ error: `SMTP ошибка: ${err.message}` })
    }
  })

  // ══════════════════════════════════════════════════════════════════════════
  // Email Campaigns
  // ══════════════════════════════════════════════════════════════════════════

  fastify.get('/api/email/campaigns', async (req) => {
    return dbGetEmailCampaigns(teamScope(req))
  })

  fastify.post('/api/email/campaigns', async (req, reply) => {
    const { name, subject, body_html, body_text, from_account_id, delay_min_sec, delay_max_sec } = req.body || {}
    if (!name || !subject || !body_html) {
      return reply.code(400).send({ error: 'name, subject, body_html обязательны' })
    }
    const campaign = await dbCreateEmailCampaign({
      name, subject, body_html, body_text, from_account_id, delay_min_sec, delay_max_sec,
      user_id: req.user?.id, team_id: req.user?.team_id,
    })
    return reply.code(201).send(campaign)
  })

  fastify.put('/api/email/campaigns/:id', async (req, reply) => {
    const { id } = req.params
    const updates = req.body || {}
    delete updates.id
    const campaign = await dbUpdateEmailCampaign(id, updates)
    return campaign
  })

  fastify.delete('/api/email/campaigns/:id', async (req, reply) => {
    await dbDeleteEmailCampaign(req.params.id)
    return { ok: true }
  })

  // ── Campaign leads ───────────────────────────────────────────────────────

  fastify.get('/api/email/campaigns/:id/leads', async (req) => {
    return dbGetEmailLeads(req.params.id)
  })

  fastify.post('/api/email/campaigns/:id/leads', async (req, reply) => {
    const { id } = req.params
    const { leads } = req.body || {}
    if (!leads || !Array.isArray(leads) || leads.length === 0) {
      return reply.code(400).send({ error: 'leads[] обязателен' })
    }
    const result = await dbAddEmailLeads(id, leads)
    return reply.code(201).send(result)
  })

  // ── Stats ────────────────────────────────────────────────────────────────

  fastify.get('/api/email/stats', async (req) => {
    return dbGetEmailStats(teamScope(req))
  })
}
