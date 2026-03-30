import {
  dbGetBlacklist, dbAddToBlacklist, dbRemoveFromBlacklist,
  dbBulkAddToBlacklist, dbGetBlacklistStats, dbCheckBlacklist,
} from '../db.js'

export default async function blacklistRoutes(fastify) {

  // GET /api/blacklist?reason=...&search=...&limit=...&offset=...
  fastify.get('/api/blacklist', async (req, reply) => {
    const { reason, search, limit = 100, offset = 0 } = req.query
    const teamId = req.user?.is_admin ? null : req.user?.team_id
    const result = await dbGetBlacklist(teamId, {
      reason, search,
      limit: Number(limit),
      offset: Number(offset),
    })
    return reply.send(result)
  })

  // GET /api/blacklist/stats
  fastify.get('/api/blacklist/stats', async (req, reply) => {
    const teamId = req.user?.is_admin ? null : req.user?.team_id
    const stats = await dbGetBlacklistStats(teamId)
    return reply.send(stats)
  })

  // GET /api/blacklist/check/:phone
  fastify.get('/api/blacklist/check/:phone', async (req, reply) => {
    const { phone } = req.params
    const teamId = req.user?.team_id
    const blocked = await dbCheckBlacklist(phone, teamId)
    return reply.send({ phone, blocked })
  })

  // POST /api/blacklist — add single phone
  fastify.post('/api/blacklist', {
    schema: {
      body: {
        type: 'object',
        required: ['phone'],
        properties: {
          phone:  { type: 'string' },
          reason: { type: 'string', enum: ['contacted', 'complained', 'blocked_us', 'manual', 'spam_report'] },
          note:   { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { phone, reason = 'manual', note } = req.body
    const teamId = req.user?.team_id
    const userId = req.user?.id
    const entry = await dbAddToBlacklist(phone.replace(/\D/g, ''), reason, teamId, null, userId, note)
    return reply.code(201).send(entry)
  })

  // POST /api/blacklist/bulk — add multiple phones
  fastify.post('/api/blacklist/bulk', {
    schema: {
      body: {
        type: 'object',
        required: ['phones'],
        properties: {
          phones: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 10000 },
          reason: { type: 'string', enum: ['contacted', 'complained', 'blocked_us', 'manual', 'spam_report'] },
        },
      },
    },
  }, async (req, reply) => {
    const { phones, reason = 'manual' } = req.body
    const teamId = req.user?.team_id
    const userId = req.user?.id
    const added = await dbBulkAddToBlacklist(phones, reason, teamId, userId)
    return reply.code(201).send({ added: added.length })
  })

  // DELETE /api/blacklist/:phone
  fastify.delete('/api/blacklist/:phone', async (req, reply) => {
    const { phone } = req.params
    const teamId = req.user?.team_id
    const includeGlobal = req.user?.is_admin || false
    await dbRemoveFromBlacklist(phone, teamId, includeGlobal)
    return reply.send({ ok: true })
  })
}
