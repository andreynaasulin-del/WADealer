import { orchestrator } from '../orchestrator.js'

export default async function sessionRoutes(fastify) {
  // GET /api/sessions — list all sessions with live status
  fastify.get('/api/sessions', async (_req, reply) => {
    const live = orchestrator.getAllSessionStates()
    return reply.send(live)
  })

  // POST /api/sessions — add a new session
  // proxy is OPTIONAL — if omitted, Froxy proxy auto-assigned with unique port
  fastify.post('/api/sessions', {
    schema: {
      body: {
        type: 'object',
        required: ['phone'],
        properties: {
          phone: { type: 'string' },
          proxy: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { phone, proxy } = req.body
    const result = await orchestrator.createSession(phone, proxy || null)
    return reply.code(201).send(result)
  })

  // POST /api/sessions/:phone/connect — manually start session (show QR)
  fastify.post('/api/sessions/:phone/connect', async (req, reply) => {
    const phone = decodeURIComponent(req.params.phone)
    const result = await orchestrator.connectSession(phone)
    return reply.send(result)
  })

  // DELETE /api/sessions/:phone — remove session
  fastify.delete('/api/sessions/:phone', async (req, reply) => {
    const phone = decodeURIComponent(req.params.phone)
    await orchestrator.deleteSession(phone)
    return reply.send({ ok: true })
  })

  // GET /api/sessions/:phone/qr — get current QR code (if pending)
  fastify.get('/api/sessions/:phone/qr', async (req, reply) => {
    const phone = decodeURIComponent(req.params.phone)
    const state = orchestrator.getSessionState(phone)
    if (!state) return reply.code(404).send({ error: 'Session not found' })
    if (!state.qrCode) return reply.code(204).send()
    return reply.send({ qrCode: state.qrCode })
  })

  // POST /api/sessions/:phone/send — send a single test message
  fastify.post('/api/sessions/:phone/send', {
    schema: {
      body: {
        type: 'object',
        required: ['to', 'text'],
        properties: {
          to:   { type: 'string' },
          text: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const phone = decodeURIComponent(req.params.phone)
    const session = orchestrator.sessions.get(phone)
    if (!session) return reply.code(404).send({ error: 'Сессия не найдена' })
    if (session.status !== 'online') return reply.code(400).send({ error: 'Сессия не в сети' })

    const { to, text } = req.body
    try {
      await session.sendMessage(to, text)
      orchestrator.log(phone, `✓ Тест → ${to}: "${text.slice(0, 50)}..."`)
      return reply.send({ ok: true, to, from: phone })
    } catch (err) {
      orchestrator.log(phone, `✗ Ошибка тест-отправки → ${to}: ${err.message}`, 'error')
      return reply.code(500).send({ error: err.message })
    }
  })

  // POST /api/sessions/:phone/pairing-code — connect via phone number + code (no QR)
  fastify.post('/api/sessions/:phone/pairing-code', async (req, reply) => {
    const phone = decodeURIComponent(req.params.phone)
    const session = orchestrator.sessions.get(phone)
    if (!session) return reply.code(404).send({ error: 'Сессия не найдена' })
    if (session.status === 'online') return reply.code(400).send({ error: 'Сессия уже онлайн' })
    try {
      await session.startWithPairingCode()
      return reply.send({ ok: true, message: 'Код запрошен — ожидай по WebSocket' })
    } catch (err) {
      return reply.code(500).send({ error: err.message })
    }
  })
}
