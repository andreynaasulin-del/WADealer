import { orchestrator } from '../orchestrator.js'
import {
  dbGetAllCampaigns,
  dbCreateCampaign,
  dbUpdateCampaign,
  dbDeleteCampaign,
  dbGetLeadsCounts,
} from '../db.js'

export default async function campaignRoutes(fastify) {
  // GET /api/campaigns — includes total_leads count
  fastify.get('/api/campaigns', async (_req, reply) => {
    const [campaigns, leadsCounts] = await Promise.all([
      dbGetAllCampaigns(),
      dbGetLeadsCounts(),
    ])
    const enriched = campaigns.map(c => ({
      ...c,
      total_leads: leadsCounts[c.id] || 0,
    }))
    return reply.send(enriched)
  })

  // POST /api/campaigns
  fastify.post('/api/campaigns', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'template_text'],
        properties: {
          name:          { type: 'string' },
          template_text: { type: 'string' },
          session_id:    { type: 'string', nullable: true },
          delay_min_sec: { type: 'integer', default: 240 },
          delay_max_sec: { type: 'integer', default: 540 },
        },
      },
    },
  }, async (req, reply) => {
    const campaign = await dbCreateCampaign(req.body)
    return reply.code(201).send(campaign)
  })

  // PUT /api/campaigns/:id — update template / settings
  fastify.put('/api/campaigns/:id', async (req, reply) => {
    const campaign = await dbUpdateCampaign(req.params.id, req.body)
    return reply.send(campaign)
  })

  // DELETE /api/campaigns/:id
  fastify.delete('/api/campaigns/:id', async (req, reply) => {
    await dbDeleteCampaign(req.params.id)
    return reply.send({ ok: true })
  })

  // PUT /api/campaigns/:id/start
  fastify.put('/api/campaigns/:id/start', async (req, reply) => {
    await orchestrator.startCampaign(req.params.id)
    return reply.send({ ok: true, status: 'running' })
  })

  // PUT /api/campaigns/:id/pause
  fastify.put('/api/campaigns/:id/pause', async (req, reply) => {
    await orchestrator.pauseCampaign(req.params.id)
    return reply.send({ ok: true, status: 'paused' })
  })

  // PUT /api/campaigns/:id/stop
  fastify.put('/api/campaigns/:id/stop', async (req, reply) => {
    await orchestrator.stopCampaign(req.params.id)
    return reply.send({ ok: true, status: 'stopped' })
  })

  // GET /api/campaigns/queue — queue status
  fastify.get('/api/campaigns/queue', async (_req, reply) => {
    return reply.send({
      status: orchestrator.queue.status,
      size:   orchestrator.queue.size,
    })
  })
}
