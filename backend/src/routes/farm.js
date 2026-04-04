import {
  dbGetFarmAccounts, dbGetFarmAccount, dbCreateFarmAccount,
  dbUpdateFarmAccount, dbGetFarmStats,
} from '../db.js'
import { calculateHealthScore } from '../wa-farmer.js'
import { orchestrator } from '../orchestrator.js'

export default async function farmRoutes(fastify) {

  // GET /api/farm/accounts — list farm accounts (filtered by user/team)
  fastify.get('/api/farm/accounts', async (req, reply) => {
    const { stage, owner_type } = req.query
    const filters = {}
    if (stage) filters.stage = stage
    if (owner_type) filters.owner_type = owner_type

    // Non-admin: show only their own + team accounts
    if (req.user && !req.user.is_admin) {
      filters.team_id = req.user.team_id
    }

    const accounts = await dbGetFarmAccounts(filters)
    return reply.send(accounts)
  })

  // GET /api/farm/accounts/:id — single account details
  fastify.get('/api/farm/accounts/:id', async (req, reply) => {
    const account = await dbGetFarmAccount(req.params.id)
    if (!account) return reply.code(404).send({ error: 'Not found' })
    return reply.send(account)
  })

  // GET /api/farm/stats — farm statistics
  fastify.get('/api/farm/stats', async (req, reply) => {
    const stats = await dbGetFarmStats()
    return reply.send(stats)
  })

  // POST /api/farm/accounts — create new farm account (admin only for platform, anyone for own)
  fastify.post('/api/farm/accounts', {
    schema: {
      body: {
        type: 'object',
        required: ['phone_number'],
        properties: {
          phone_number:   { type: 'string' },
          provider:       { type: 'string' },
          cost_usd:       { type: 'number' },
          proxy_string:   { type: 'string' },
          display_name:   { type: 'string' },
          owner_type:     { type: 'string', enum: ['platform', 'user'] },
        },
      },
    },
  }, async (req, reply) => {
    const { phone_number, provider, cost_usd, proxy_string, display_name, owner_type } = req.body

    // Only admin can create platform accounts
    if ((owner_type || 'platform') === 'platform' && !req.user?.is_admin) {
      return reply.code(403).send({ error: 'Only admin can create platform farm accounts' })
    }

    const account = await dbCreateFarmAccount({
      phone_number: phone_number.replace(/\D/g, ''),
      provider: provider || (owner_type === 'user' ? 'user-own' : 'manual'),
      cost_usd,
      proxy_string,
      display_name,
      owner_user_id: req.user?.id,
      owner_type: owner_type || 'platform',
      team_id: req.user?.team_id,
    })

    return reply.code(201).send(account)
  })

  // POST /api/farm/connect-own — user connects their own WhatsApp for farming
  fastify.post('/api/farm/connect-own', {
    schema: {
      body: {
        type: 'object',
        required: ['phone_number'],
        properties: {
          phone_number: { type: 'string' },
          proxy_string: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { phone_number, proxy_string } = req.body
    const cleanPhone = phone_number.replace(/\D/g, '')

    const account = await dbCreateFarmAccount({
      phone_number: cleanPhone,
      provider: 'user-own',
      owner_user_id: req.user?.id,
      owner_type: 'user',
      team_id: req.user?.team_id,
      proxy_string,
    })

    // Create a real Baileys session so the user can connect via QR
    try {
      await orchestrator.createSession(cleanPhone, proxy_string || null, req.user?.id, req.user?.team_id, { skipFroxy: !proxy_string })
    } catch (err) {
      if (!err.message.includes('уже существует')) {
        // Non-fatal — account is created, session can be added manually
        orchestrator.log(cleanPhone, `[FARM] Session init warning: ${err.message}`, 'warn')
      }
    }

    return reply.code(201).send(account)
  })

  // PUT /api/farm/accounts/:id — update farm account
  fastify.put('/api/farm/accounts/:id', async (req, reply) => {
    const { id } = req.params
    const allowed = ['proxy_string', 'display_name', 'stage', 'sale_price_usd']
    const updates = {}
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key]
    }

    const account = await dbUpdateFarmAccount(id, updates)
    return reply.send(account)
  })

  // POST /api/farm/accounts/:id/start-warmup — start warmup for account
  fastify.post('/api/farm/accounts/:id/start-warmup', async (req, reply) => {
    const farmer = orchestrator.farmer
    if (!farmer) return reply.code(500).send({ error: 'Farmer not initialized' })

    const account = await farmer.startWarmup(req.params.id)
    return reply.send(account)
  })

  // POST /api/farm/accounts/:id/recalc-health — recalculate health score
  fastify.post('/api/farm/accounts/:id/recalc-health', async (req, reply) => {
    const account = await dbGetFarmAccount(req.params.id)
    if (!account) return reply.code(404).send({ error: 'Not found' })

    const health = calculateHealthScore(account)
    const updated = await dbUpdateFarmAccount(account.id, { health_score: health })
    return reply.send(updated)
  })

  // DELETE /api/farm/accounts/:id — delete farm account (admin only)
  fastify.delete('/api/farm/accounts/:id', async (req, reply) => {
    if (!req.user?.is_admin) return reply.code(403).send({ error: 'Admin only' })

    const { error } = await (await import('../db.js')).default
      .from('wa_farm_accounts')
      .delete()
      .eq('id', req.params.id)

    if (error) throw error
    return reply.send({ ok: true })
  })
}
