import { orchestrator } from '../orchestrator.js'
import { dbGetConversations, dbGetConversationMessages } from '../db.js'

export default async function crmRoutes(fastify) {
  // ── List conversations ────────────────────────────────────────────────────
  fastify.get('/api/crm/conversations', async (req) => {
    const sessionPhone = req.query.session_phone || null
    return dbGetConversations(sessionPhone)
  })

  // ── Get messages for a conversation ───────────────────────────────────────
  fastify.get('/api/crm/conversations/:phone', async (req) => {
    const { phone } = req.params
    const limit = parseInt(req.query.limit || '50', 10)
    const offset = parseInt(req.query.offset || '0', 10)
    return dbGetConversationMessages(phone, limit, offset)
  })

  // ── Send message from CRM ────────────────────────────────────────────────
  fastify.post('/api/crm/conversations/:phone/send', async (req, reply) => {
    const { phone } = req.params
    const { text, session_phone } = req.body || {}

    if (!text?.trim()) {
      return reply.code(400).send({ error: 'Текст сообщения обязателен' })
    }

    // Find an online session to send through
    let sessionPhone = session_phone
    if (!sessionPhone) {
      const onlineSession = orchestrator.getAllSessionStates().find(s => s.status === 'online')
      if (!onlineSession) {
        return reply.code(400).send({ error: 'Нет онлайн-сессий для отправки' })
      }
      sessionPhone = onlineSession.phone
    }

    const session = orchestrator.sessions.get(sessionPhone)
    if (!session || session.status !== 'online') {
      return reply.code(400).send({ error: `Сессия ${sessionPhone} не в сети` })
    }

    const result = await session.sendMessage(phone, text.trim())

    // Store the outgoing message
    await orchestrator.storeMessage(sessionPhone, phone, 'outbound', text.trim(), result?.key?.id)

    return { ok: true, from: sessionPhone, to: phone }
  })
}
