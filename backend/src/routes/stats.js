import { dbGetStats, dbGetTiers } from '../db.js'
import { orchestrator } from '../orchestrator.js'

export default async function statsRoutes(fastify) {
  // GET /api/stats — aggregate stats
  fastify.get('/api/stats', async (req, reply) => {
    const dbStats = await dbGetStats()
    const queueStatus = orchestrator.queue.status
    const queueSize   = orchestrator.queue.size

    // Filter session counts by user's sessions if not admin
    if (req.user && !req.user.is_admin) {
      const allSessions = orchestrator.getAllSessionStates()
      const userSessions = allSessions.filter(s => s.user_id === req.user.id)
      dbStats.sessions_total = userSessions.length
      dbStats.sessions_online = userSessions.filter(s => s.status === 'online').length
      dbStats.sessions_offline = userSessions.filter(s => s.status === 'offline').length
      dbStats.sessions_banned = userSessions.filter(s => s.status === 'banned').length
    }

    return reply.send({
      ...dbStats,
      queue_status: queueStatus,
      queue_size:   queueSize,
    })
  })

  // GET /api/dashboard — full SaaS dashboard stats
  fastify.get('/api/dashboard', async (req, reply) => {
    try {
      const stats = await orchestrator.getDashboardStats()
      // Filter dashboard stats by user's team if not admin
      if (req.user && !req.user.is_admin) {
        const allSessions = orchestrator.getAllSessionStates()
        const userSessions = allSessions.filter(s => s.user_id === req.user.id)
        if (stats.wa) {
          stats.wa.sessions_total = userSessions.length
          stats.wa.sessions_online = userSessions.filter(s => s.status === 'online').length
        }
      }
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

  // ── WA Warmup ──────────────────────────────────────────────────────────────

  // POST /api/warmup/start — start warmup cycle
  fastify.post('/api/warmup/start', async (_req, reply) => {
    orchestrator.warmup.start()
    return reply.send({ ok: true, active: true })
  })

  // POST /api/warmup/stop — stop warmup cycle
  fastify.post('/api/warmup/stop', async (_req, reply) => {
    orchestrator.warmup.stop()
    return reply.send({ ok: true, active: false })
  })

  // GET /api/warmup/status — check warmup status
  fastify.get('/api/warmup/status', async (_req, reply) => {
    return reply.send({ active: orchestrator.warmup.isActive })
  })
}
