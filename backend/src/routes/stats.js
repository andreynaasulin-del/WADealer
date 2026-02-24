import { dbGetStats } from '../db.js'
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
}
