import {
  dbGetReadyAccounts, dbGetFarmAccount, dbPurchaseFarmAccount,
  dbGetFarmAccounts, dbUpdateFarmAccount,
} from '../db.js'

export default async function marketplaceRoutes(fastify) {

  // GET /api/marketplace/accounts — list available (ready, unsold) accounts
  fastify.get('/api/marketplace/accounts', async (req, reply) => {
    const accounts = await dbGetReadyAccounts()
    // Hide sensitive fields
    const safe = accounts.map(a => ({
      id: a.id,
      phone_prefix: a.phone_number.slice(0, 6) + '****',
      provider: a.provider,
      warmup_day: a.warmup_day,
      health_score: a.health_score,
      has_avatar: a.has_avatar,
      has_status: a.has_status,
      groups_joined: a.groups_joined,
      messages_sent_total: a.messages_sent_total,
      messages_received_total: a.messages_received_total,
      sale_price_usd: a.sale_price_usd,
      registered_at: a.registered_at,
      ready_at: a.ready_at,
    }))
    return reply.send(safe)
  })

  // GET /api/marketplace/accounts/:id — account details
  fastify.get('/api/marketplace/accounts/:id', async (req, reply) => {
    const account = await dbGetFarmAccount(req.params.id)
    if (!account || account.stage !== 'ready') {
      return reply.code(404).send({ error: 'Account not available' })
    }
    return reply.send({
      id: account.id,
      phone_prefix: account.phone_number.slice(0, 6) + '****',
      provider: account.provider,
      warmup_day: account.warmup_day,
      health_score: account.health_score,
      has_avatar: account.has_avatar,
      has_status: account.has_status,
      groups_joined: account.groups_joined,
      messages_sent_total: account.messages_sent_total,
      messages_received_total: account.messages_received_total,
      sale_price_usd: account.sale_price_usd,
      registered_at: account.registered_at,
      ready_at: account.ready_at,
    })
  })

  // POST /api/marketplace/purchase/:id — buy a ready account
  fastify.post('/api/marketplace/purchase/:id', async (req, reply) => {
    const userId = req.user?.id
    if (!userId) return reply.code(401).send({ error: 'Not authenticated' })

    try {
      const account = await dbPurchaseFarmAccount(req.params.id, userId)
      if (!account) return reply.code(409).send({ error: 'Account already sold or not available' })

      // Broadcast purchase event
      fastify.orchestrator?.broadcast({
        type: 'marketplace_purchase',
        account_id: account.id,
        phone: account.phone_number,
        buyer_user_id: userId,
      })

      return reply.send({
        ok: true,
        account_id: account.id,
        phone_number: account.phone_number,
        message: 'Account purchased. It will appear in your sessions.',
      })
    } catch (err) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // GET /api/marketplace/my-accounts — user's purchased accounts
  fastify.get('/api/marketplace/my-accounts', async (req, reply) => {
    const userId = req.user?.id
    const accounts = await dbGetFarmAccounts({ sold_to_user_id: userId })
    return reply.send(accounts)
  })

  // POST /api/marketplace/return/:id — return within 24h if banned
  fastify.post('/api/marketplace/return/:id', async (req, reply) => {
    const userId = req.user?.id
    const account = await dbGetFarmAccount(req.params.id)

    if (!account) return reply.code(404).send({ error: 'Not found' })
    if (account.sold_to_user_id !== userId) return reply.code(403).send({ error: 'Not your account' })

    // Check 24h window
    if (account.sold_at) {
      const hoursSincePurchase = (Date.now() - new Date(account.sold_at).getTime()) / (60 * 60 * 1000)
      if (hoursSincePurchase > 24) {
        return reply.code(400).send({ error: 'Return window expired (24h)' })
      }
    }

    // Only allow return if account is banned
    if (account.stage !== 'banned') {
      return reply.code(400).send({ error: 'Returns only accepted for banned accounts' })
    }

    await dbUpdateFarmAccount(account.id, {
      stage: 'banned',
      sold_to_user_id: null,
      sold_at: null,
    })

    return reply.send({ ok: true, message: 'Account returned' })
  })
}
