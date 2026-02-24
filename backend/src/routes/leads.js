import { dbGetLeads, dbImportLeadsFromTahles, dbAddManualLeads } from '../db.js'

export default async function leadRoutes(fastify) {
  // GET /api/leads?campaign_id=...&status=...&limit=...&offset=...
  fastify.get('/api/leads', async (req, reply) => {
    const { campaign_id, status, limit = 100, offset = 0 } = req.query
    const result = await dbGetLeads({
      campaign_id,
      status,
      limit: Number(limit),
      offset: Number(offset),
    })
    return reply.send(result)
  })

  // POST /api/leads/import — import contacts from Tahles advertisements
  fastify.post('/api/leads/import', {
    schema: {
      body: {
        type: 'object',
        required: ['campaign_id'],
        properties: {
          campaign_id: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { campaign_id } = req.body
    const result = await dbImportLeadsFromTahles(campaign_id)
    return reply.code(201).send(result)
  })

  // POST /api/leads/add — manually add phone numbers to a campaign
  fastify.post('/api/leads/add', {
    schema: {
      body: {
        type: 'object',
        required: ['campaign_id', 'phones'],
        properties: {
          campaign_id: { type: 'string' },
          phones:      { type: 'array', items: { type: 'string' } },
        },
      },
    },
  }, async (req, reply) => {
    const { campaign_id, phones } = req.body
    const result = await dbAddManualLeads(campaign_id, phones)
    return reply.code(201).send(result)
  })
}
