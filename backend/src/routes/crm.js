import { orchestrator } from '../orchestrator.js'
import { dbGetConversations, dbGetConversationMessages } from '../db.js'

export default async function crmRoutes(fastify) {
  // ── List conversations ────────────────────────────────────────────────────
  fastify.get('/api/crm/conversations', async (req) => {
    const sessionPhone = req.query.session_phone || null
    const campaignId = req.query.campaign_id || null
    let conversations = await dbGetConversations(sessionPhone, campaignId)
    // Filter by user's sessions if not admin
    if (req.user && !req.user.is_admin) {
      const userSessions = orchestrator.getAllSessionStates(req.user.id, req.user.team_id)
      const teamPhones = new Set(userSessions.map(s => s.phone))
      conversations = conversations.filter(c => teamPhones.has(c.session_phone))
    }
    return conversations
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

    // Find an online session to send through (filtered by user)
    let sessionPhone = session_phone
    if (!sessionPhone) {
      let sessions = orchestrator.getAllSessionStates().filter(s => s.status === 'online')
      if (req.user && !req.user.is_admin) {
        sessions = sessions.filter(s => s.user_id === req.user.id)
      }
      const onlineSession = sessions[0]
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

  // ── Force AI follow-up for a conversation (cleans dupes + triggers reply) ─
  fastify.post('/api/crm/conversations/:phone/force-ai', async (req, reply) => {
    const { phone } = req.params
    try {
      await orchestrator.forceAiReply(phone)
      return { ok: true, phone }
    } catch (err) {
      return reply.code(400).send({ error: err.message })
    }
  })

  // ── Delete a message "for everyone" via Baileys ─────────────────────────
  fastify.delete('/api/crm/messages/:id', async (req, reply) => {
    const { id } = req.params
    try {
      // Find the message in DB
      const messages = await dbGetConversationMessages('', 1000) // not ideal
      // Use direct Supabase query instead
      return reply.code(501).send({ error: 'Используйте /api/crm/conversations/:phone/force-ai для очистки дубликатов' })
    } catch (err) {
      return reply.code(400).send({ error: err.message })
    }
  })
}
