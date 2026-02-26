import OpenAI from 'openai'
import 'dotenv/config'

const apiKey = process.env.OPENAI_API_KEY
let openai = null
if (apiKey && apiKey !== 'YOUR_OPENAI_API_KEY') {
  openai = new OpenAI({ apiKey })
}

// System prompt — the AI acts as a WhatsApp outreach strategist
const SYSTEM_PROMPT = `Ты — AI-ассистент платформы WA Dealer. Ты помогаешь пользователю:

1. Составлять шаблоны сообщений для WhatsApp-рассылок (с Spintax {вариант1|вариант2})
2. Разрабатывать стратегию общения с лидами
3. Придумывать скрипты продаж и follow-up сообщения
4. Анализировать ответы лидов и советовать, как реагировать
5. Помогать с критериями для AI-Детектора лидов (HOT/WARM/COLD/IRRELEVANT)
6. Оптимизировать конверсию рассылки

Правила:
- Отвечай коротко и по делу, без воды
- Используй русский язык (можно с иврит/английскими терминами если нужно)
- Если просят шаблон — сразу давай готовый текст со Spintax
- Если обсуждают стратегию — давай конкретные шаги
- Можешь предлагать A/B тесты разных подходов
- Помни: рассылка идёт через WhatsApp, поэтому сообщения должны быть короткие, личные, не спамные
- Форматируй ответы с emoji для наглядности
- Если пользователь описывает свой бизнес — адаптируй советы под его нишу`

export default async function aiChatRoutes(app) {
  // POST /api/ai/chat — send message to AI assistant
  app.post('/api/ai/chat', async (req, reply) => {
    if (!openai) {
      return reply.code(503).send({ error: 'OpenAI API ключ не настроен' })
    }

    const { messages, context } = req.body || {}

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return reply.code(400).send({ error: 'Сообщения не предоставлены' })
    }

    // Build messages array for OpenAI
    const systemContent = context
      ? `${SYSTEM_PROMPT}\n\nКонтекст текущей кампании:\n${context}`
      : SYSTEM_PROMPT

    const openaiMessages = [
      { role: 'system', content: systemContent },
      ...messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      })),
    ]

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: openaiMessages,
        temperature: 0.7,
        max_tokens: 1500,
      })

      const reply_content = response.choices[0].message.content
      return { reply: reply_content }
    } catch (err) {
      app.log.error(err)
      return reply.code(500).send({ error: `AI ошибка: ${err.message}` })
    }
  })

  // POST /api/ai/suggest-template — quick template generation
  app.post('/api/ai/suggest-template', async (req, reply) => {
    if (!openai) {
      return reply.code(503).send({ error: 'OpenAI API ключ не настроен' })
    }

    const { business, goal, tone } = req.body || {}

    if (!business) {
      return reply.code(400).send({ error: 'Опишите бизнес' })
    }

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Ты генерируешь шаблоны WhatsApp-сообщений со Spintax синтаксисом {вариант1|вариант2|вариант3}.
Формат ответа — JSON: {"templates": [{"text": "...", "description": "..."}]}
Генерируй 3 варианта. Сообщения должны быть короткие (до 200 символов), личные, не спамные.`,
          },
          {
            role: 'user',
            content: `Бизнес: ${business}\nЦель: ${goal || 'привлечь клиентов'}\nТон: ${tone || 'дружелюбный, профессиональный'}`,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.8,
        max_tokens: 800,
      })

      const content = response.choices[0].message.content
      return JSON.parse(content)
    } catch (err) {
      app.log.error(err)
      return reply.code(500).send({ error: `AI ошибка: ${err.message}` })
    }
  })

  // POST /api/ai/reply-suggest — suggest reply to a lead
  app.post('/api/ai/reply-suggest', async (req, reply) => {
    if (!openai) {
      return reply.code(503).send({ error: 'OpenAI API ключ не настроен' })
    }

    const { leadMessage, ourMessage, goal } = req.body || {}

    if (!leadMessage) {
      return reply.code(400).send({ error: 'Сообщение лида не предоставлено' })
    }

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Ты помогаешь отвечать на сообщения лидов в WhatsApp.
Дай 2-3 варианта ответа. Ответы должны быть короткие, личные, продвигающие к цели.
Формат: JSON {"replies": [{"text": "...", "strategy": "..."}]}`,
          },
          {
            role: 'user',
            content: `${ourMessage ? `Наше сообщение: ${ourMessage}\n` : ''}Ответ лида: ${leadMessage}\nЦель: ${goal || 'довести до сделки'}`,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 600,
      })

      const content = response.choices[0].message.content
      return JSON.parse(content)
    } catch (err) {
      app.log.error(err)
      return reply.code(500).send({ error: `AI ошибка: ${err.message}` })
    }
  })
}
