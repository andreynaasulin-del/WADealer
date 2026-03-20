import { orchestrator } from '../orchestrator.js'
import * as db from '../db.js'

export default async function telegramRoutes(fastify) {

  // ══════════════════════════════════════════════════════════════════════════
  // ACCOUNTS (user profiles, not bots)
  // ══════════════════════════════════════════════════════════════════════════

  // ── GET /api/telegram/accounts — list all accounts ───────────────────────
  fastify.get('/api/telegram/accounts', async (req, reply) => {
    const accounts = orchestrator.getAllTelegramAccountStates()
    return reply.send(accounts)
  })

  // ── POST /api/telegram/accounts — add a new account (phone number) ──────
  fastify.post('/api/telegram/accounts', {
    schema: {
      body: {
        type: 'object',
        required: ['phone'],
        properties: {
          phone: { type: 'string', minLength: 5 },
        },
      },
    },
  }, async (req, reply) => {
    const { phone } = req.body
    const result = await orchestrator.createTelegramAccount(phone)
    return reply.code(201).send(result)
  })

  // ── POST /api/telegram/accounts/:id/request-code — send verification code
  fastify.post('/api/telegram/accounts/:id/request-code', async (req, reply) => {
    const result = await orchestrator.requestTelegramCode(req.params.id)
    return reply.send(result)
  })

  // ── POST /api/telegram/accounts/:id/qr-login — generate QR code for login
  fastify.post('/api/telegram/accounts/:id/qr-login', async (req, reply) => {
    const result = await orchestrator.requestTelegramQrLogin(req.params.id)
    return reply.send(result)
  })

  // ── POST /api/telegram/accounts/:id/verify-code — submit the code ──────
  fastify.post('/api/telegram/accounts/:id/verify-code', {
    schema: {
      body: {
        type: 'object',
        required: ['code'],
        properties: {
          code: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (req, reply) => {
    const result = await orchestrator.verifyTelegramCode(req.params.id, req.body.code)
    return reply.send(result)
  })

  // ── POST /api/telegram/accounts/:id/verify-password — submit 2FA password
  fastify.post('/api/telegram/accounts/:id/verify-password', {
    schema: {
      body: {
        type: 'object',
        required: ['password'],
        properties: {
          password: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (req, reply) => {
    const result = await orchestrator.verifyTelegramPassword(req.params.id, req.body.password)
    return reply.send(result)
  })

  // ── POST /api/telegram/accounts/:id/connect — reconnect existing session ─
  fastify.post('/api/telegram/accounts/:id/connect', async (req, reply) => {
    const result = await orchestrator.connectTelegramAccount(req.params.id)
    return reply.send(result)
  })

  // ── POST /api/telegram/accounts/:id/disconnect — disconnect ──────────────
  fastify.post('/api/telegram/accounts/:id/disconnect', async (req, reply) => {
    await orchestrator.disconnectTelegramAccount(req.params.id)
    return reply.send({ id: req.params.id, status: 'disconnected' })
  })

  // ── DELETE /api/telegram/accounts/:id — delete account ───────────────────
  fastify.delete('/api/telegram/accounts/:id', async (req, reply) => {
    await orchestrator.deleteTelegramAccount(req.params.id)
    return reply.code(204).send()
  })

  // ── POST /api/telegram/accounts/:id/send — test message ─────────────────
  fastify.post('/api/telegram/accounts/:id/send', {
    schema: {
      body: {
        type: 'object',
        required: ['chat_id', 'text'],
        properties: {
          chat_id: { type: 'string', minLength: 1 },
          text:    { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (req, reply) => {
    const { chat_id, text } = req.body
    const session = orchestrator.telegramAccounts.get(req.params.id)
    if (!session) {
      return reply.code(404).send({ error: 'Аккаунт не найден' })
    }
    await session.sendMessage(chat_id, text)
    return reply.send({ ok: true })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // CAMPAIGNS
  // ══════════════════════════════════════════════════════════════════════════

  fastify.get('/api/telegram/campaigns', async (req, reply) => {
    const campaigns = await db.dbGetAllTelegramCampaigns()
    const enriched = await Promise.all(campaigns.map(async (c) => {
      const totalLeads = await db.dbCountTelegramLeads(c.id)
      return { ...c, total_leads: totalLeads }
    }))
    return reply.send(enriched)
  })

  fastify.post('/api/telegram/campaigns', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'template_text'],
        properties: {
          name:          { type: 'string', minLength: 1 },
          template_text: { type: 'string', minLength: 1 },
          account_id:    { type: 'string' },
          delay_min_sec: { type: 'number', minimum: 1, default: 3 },
          delay_max_sec: { type: 'number', minimum: 1, default: 8 },
        },
      },
    },
  }, async (req, reply) => {
    const campaign = await db.dbCreateTelegramCampaign(req.body)
    return reply.code(201).send(campaign)
  })

  fastify.put('/api/telegram/campaigns/:id', async (req, reply) => {
    const campaign = await db.dbUpdateTelegramCampaign(req.params.id, req.body)
    return reply.send(campaign)
  })

  fastify.delete('/api/telegram/campaigns/:id', async (req, reply) => {
    await db.dbDeleteTelegramCampaign(req.params.id)
    return reply.code(204).send()
  })

  fastify.put('/api/telegram/campaigns/:id/start', async (req, reply) => {
    await orchestrator.startTelegramCampaign(req.params.id)
    return reply.send({ ok: true })
  })

  fastify.put('/api/telegram/campaigns/:id/pause', async (req, reply) => {
    await orchestrator.pauseTelegramCampaign(req.params.id)
    return reply.send({ ok: true })
  })

  fastify.put('/api/telegram/campaigns/:id/stop', async (req, reply) => {
    await orchestrator.stopTelegramCampaign(req.params.id)
    return reply.send({ ok: true })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // LEADS
  // ══════════════════════════════════════════════════════════════════════════

  fastify.get('/api/telegram/leads', async (req, reply) => {
    const { campaign_id, status, limit, offset } = req.query
    const result = await db.dbGetTelegramLeads({
      campaign_id, status,
      limit: limit ? parseInt(limit) : 100,
      offset: offset ? parseInt(offset) : 0,
    })
    return reply.send(result)
  })

  fastify.post('/api/telegram/leads/add', {
    schema: {
      body: {
        type: 'object',
        required: ['campaign_id', 'chat_ids'],
        properties: {
          campaign_id: { type: 'string' },
          chat_ids:    { type: 'array', items: { type: 'string' } },
        },
      },
    },
  }, async (req, reply) => {
    const { campaign_id, chat_ids } = req.body
    const result = await db.dbAddTelegramLeads(campaign_id, chat_ids)
    return reply.send(result)
  })

  // ══════════════════════════════════════════════════════════════════════════
  // STATS
  // ══════════════════════════════════════════════════════════════════════════

  fastify.get('/api/telegram/stats', async (req, reply) => {
    const stats = await db.dbGetTelegramStats()
    stats.queue_status = orchestrator.telegramQueue?.status || 'stopped'
    stats.queue_size = orchestrator.telegramQueue?.size || 0
    return reply.send(stats)
  })

  // ══════════════════════════════════════════════════════════════════════════
  // SOURCE GROUPS (scrape targets)
  // ══════════════════════════════════════════════════════════════════════════

  fastify.get('/api/telegram/source-groups', async (req, reply) => {
    const groups = await db.dbGetAllSourceGroups()
    return reply.send(groups)
  })

  fastify.post('/api/telegram/source-groups', {
    schema: {
      body: {
        type: 'object',
        required: ['links'],
        properties: {
          links: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  }, async (req, reply) => {
    const groups = await orchestrator.addSourceGroups(req.body.links)
    return reply.code(201).send(groups)
  })

  fastify.delete('/api/telegram/source-groups/:id', async (req, reply) => {
    await db.dbDeleteSourceGroup(req.params.id)
    return reply.code(204).send()
  })

  // ══════════════════════════════════════════════════════════════════════════
  // SCRAPE CONTROL
  // ══════════════════════════════════════════════════════════════════════════

  fastify.post('/api/telegram/scrape/start', {
    schema: {
      body: {
        type: 'object',
        required: ['account_id'],
        properties: {
          account_id: { type: 'string' },
          group_id:   { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { account_id, group_id } = req.body
    // Run async — don't block the request
    if (group_id) {
      orchestrator.scrapeGroup(group_id, account_id).catch(err => {
        orchestrator.log(null, `Scrape error: ${err.message}`, 'error', 'telegram')
      })
    } else {
      orchestrator.scrapeAllGroups(account_id).catch(err => {
        orchestrator.log(null, `Scrape all error: ${err.message}`, 'error', 'telegram')
      })
    }
    return reply.send({ ok: true })
  })

  fastify.post('/api/telegram/scrape/stop', async (req, reply) => {
    orchestrator.stopScrapeJob()
    return reply.send({ ok: true })
  })

  fastify.get('/api/telegram/scrape/status', async (req, reply) => {
    return reply.send(orchestrator.getScrapeStatus())
  })

  // ══════════════════════════════════════════════════════════════════════════
  // SCRAPED MEMBERS
  // ══════════════════════════════════════════════════════════════════════════

  fastify.get('/api/telegram/scraped-members', async (req, reply) => {
    const { invite_status, limit, offset } = req.query
    const result = await db.dbGetScrapedMembers({
      invite_status,
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
    })
    return reply.send(result)
  })

  fastify.get('/api/telegram/scraped-members/stats', async (req, reply) => {
    const stats = await db.dbGetScrapedMembersStats()
    return reply.send(stats)
  })

  // ══════════════════════════════════════════════════════════════════════════
  // INVITE CONTROL
  // ══════════════════════════════════════════════════════════════════════════

  fastify.post('/api/telegram/invite/start', {
    schema: {
      body: {
        type: 'object',
        required: ['account_id', 'target_channel'],
        properties: {
          account_id:     { type: 'string' },
          target_channel: { type: 'string' },
          daily_limit:    { type: 'number', minimum: 1, default: 50 },
        },
      },
    },
  }, async (req, reply) => {
    const { account_id, target_channel, daily_limit } = req.body
    orchestrator.startInviteJob(account_id, target_channel, daily_limit || 50).catch(err => {
      orchestrator.log(null, `Invite error: ${err.message}`, 'error', 'telegram')
    })
    return reply.send({ ok: true })
  })

  fastify.post('/api/telegram/invite/stop', async (req, reply) => {
    orchestrator.stopInviteJob()
    return reply.send({ ok: true })
  })

  fastify.get('/api/telegram/invite/status', async (req, reply) => {
    return reply.send(orchestrator.getInviteStatus())
  })

  // ══════════════════════════════════════════════════════════════════════════
  // PER-ACCOUNT SETTINGS
  // ══════════════════════════════════════════════════════════════════════════

  // ── GET /api/telegram/accounts/:id/settings — get account settings
  fastify.get('/api/telegram/accounts/:id/settings', async (req, reply) => {
    const settings = await orchestrator.getTelegramAccountSettings(req.params.id)
    return reply.send(settings)
  })

  // ── PUT /api/telegram/accounts/:id/settings — update account settings
  fastify.put('/api/telegram/accounts/:id/settings', async (req, reply) => {
    const settings = await orchestrator.updateTelegramAccountSettings(req.params.id, req.body.settings || req.body)
    return reply.send(settings)
  })

  // ── PUT /api/telegram/accounts/:id/proxy — update account proxy
  fastify.put('/api/telegram/accounts/:id/proxy', async (req, reply) => {
    const result = await orchestrator.updateTelegramAccountProxy(req.params.id, req.body.proxy_string)
    return reply.send(result)
  })

  // ══════════════════════════════════════════════════════════════════════════
  // MULTI-ACCOUNT INVITE
  // ══════════════════════════════════════════════════════════════════════════

  fastify.post('/api/telegram/invite/multi-start', async (req, reply) => {
    const { channels, daily_limit_per_account, delay_between_invites_sec } = req.body
    if (!channels || !Array.isArray(channels) || channels.length === 0) {
      return reply.code(400).send({ error: 'channels обязателен (массив)' })
    }
    orchestrator.startMultiAccountInvite(channels, daily_limit_per_account, delay_between_invites_sec).catch(err => {
      orchestrator.log(null, `Multi-invite error: ${err.message}`, 'error', 'telegram')
    })
    return reply.send({ ok: true })
  })

  fastify.post('/api/telegram/invite/multi-stop', async (req, reply) => {
    orchestrator.stopMultiInvite()
    return reply.send({ ok: true })
  })
}
