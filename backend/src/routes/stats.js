import { dbGetStats, dbGetTiers } from '../db.js'
import { orchestrator } from '../orchestrator.js'

export default async function statsRoutes(fastify) {
  // GET /api/stats — aggregate stats
  fastify.get('/api/stats', async (_req, reply) => {
    const dbStats = await dbGetStats()
    const queueStatus = orchestrator.queue.status
    const queueSize   = orchestrator.queue.size

    return reply.send({
      ...dbStats,
      queue_status: queueStatus,
      queue_size:   queueSize,
    })
  })

  // GET /api/dashboard — full SaaS dashboard stats
  fastify.get('/api/dashboard', async (_req, reply) => {
    try {
      const stats = await orchestrator.getDashboardStats()
      return reply.send(stats)
    } catch (err) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // GET /api/tiers — get available tier plans
  fastify.get('/api/tiers', async (_req, reply) => {
    try {
      const tiers = await dbGetTiers()
      return reply.send(tiers)
    } catch (err) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // GET /api/heartbeat — get last heartbeat status
  fastify.get('/api/heartbeat', async (_req, reply) => {
    try {
      await orchestrator._runHeartbeat()
      return reply.send({ ok: true, ts: new Date().toISOString() })
    } catch (err) {
      return reply.code(500).send({ error: err.message })
    }
  })
}
