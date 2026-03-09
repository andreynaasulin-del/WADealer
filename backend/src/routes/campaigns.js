import { orchestrator } from '../orchestrator.js'
import {
  dbGetAllCampaigns,
  dbCreateCampaign,
  dbUpdateCampaign,
  dbDeleteCampaign,
  dbGetLeadsCounts,
  dbGetRepliedLeads,
  dbGetConversationMessages,
  dbUpdateLeadAI,
} from '../db.js'
import { extractConversationData, calculateScore, scoreCategory } from '../ai-responder.js'

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
          ai_criteria:   { type: 'string', nullable: true },
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

  // POST /api/leads/batch-score — score all replied leads 0-100
  fastify.post('/api/leads/batch-score', async (_req, reply) => {
    const leads = await dbGetRepliedLeads()
    let scored = 0, errors = 0, skipped = 0

    for (const lead of leads) {
      try {
        const phone = lead.phone.replace(/\D/g, '')
        let data = null

        // Try parsing existing ai_reason first (already extracted data)
        if (lead.ai_reason) {
          try { data = JSON.parse(lead.ai_reason) } catch {}
        }

        // If no data yet, extract from conversation
        if (!data || !data.city) {
          const messages = await dbGetConversationMessages(phone, 100)
          if (messages && messages.length >= 2) {
            data = await extractConversationData(messages)
          }
        }

        if (!data) { skipped++; continue }

        // Calculate numeric score
        const num = calculateScore(data)
        const cat = scoreCategory(num)

        // Store score in ai_reason JSON + update category
        data.score_num = num
        await dbUpdateLeadAI(lead.id, {
          ai_score: cat,
          ai_reason: JSON.stringify(data),
        })
        scored++
      } catch (err) {
        console.error(`[batch-score] Error for ${lead.phone}:`, err.message)
        errors++
      }
    }

    return reply.send({ ok: true, total: leads.length, scored, errors, skipped })
  })

  // GET /api/leads/feed?min_score=20&limit=200
  // Returns non-empty leads sorted by score — for the public feed on site
  fastify.get('/api/leads/feed', async (req, reply) => {
    const minScore = Number(req.query.min_score ?? 20)
    const limit    = Math.min(Number(req.query.limit ?? 200), 500)

    const leads = await dbGetRepliedLeads()

    const enriched = []
    for (const lead of leads) {
      let parsed = null
      try { parsed = JSON.parse(lead.ai_reason) } catch {}

      const score = parsed?.score_num ?? null

      // Skip if no score or score too low
      if (score == null || score < minScore) continue

      const filled = v => v && v !== 'null' && v !== 'N/A' && v !== 'unknown'

      // Must have at least city OR address, AND price
      const hasLocation = filled(parsed?.city) || filled(parsed?.address)
      const hasPrice    = filled(parsed?.price_text) || filled(parsed?.price_min)
      if (!hasLocation && !hasPrice) continue

      enriched.push({
        phone:     lead.phone,
        score,
        category:  score >= 80 ? 'HOT' : score >= 50 ? 'WARM' : score >= 20 ? 'COLD' : 'IRRELEVANT',
        city:                  parsed?.city || null,
        address:               parsed?.address || null,
        price_text:            parsed?.price_text || null,
        price_min:             parsed?.price_min || null,
        price_max:             parsed?.price_max || null,
        nationality:           parsed?.nationality || null,
        incall_outcall:        parsed?.incall_outcall || null,
        independent_or_agency: parsed?.independent_or_agency || null,
        has_photos:            parsed?.has_photos || false,
        has_video:             parsed?.has_video || false,
        age:                   parsed?.age || null,
        services:              parsed?.services || null,
        availability:          parsed?.availability || null,
        sentiment:             parsed?.sentiment || null,
      })
    }

    enriched.sort((a, b) => b.score - a.score)
    const page = enriched.slice(0, limit)

    return reply.send({
      ok: true,
      total: enriched.length,
      returned: page.length,
      leads: page,
    })
  })
}
