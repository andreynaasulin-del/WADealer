import OpenAI from 'openai'
import 'dotenv/config'

const apiKey = process.env.OPENAI_API_KEY

let openai = null
if (apiKey && apiKey !== 'YOUR_OPENAI_API_KEY') {
  openai = new OpenAI({ apiKey })
}

/**
 * Classify a lead based on their reply and user-defined criteria.
 *
 * @param {string} criteria     - What the user expects from leads
 * @param {string} outboundMsg  - What was sent to the lead
 * @param {string} inboundReply - What the lead replied
 * @returns {Promise<{ score: 'hot'|'warm'|'cold'|'irrelevant', reason: string }>}
 */
export async function classifyLead(criteria, outboundMsg, inboundReply) {
  if (!openai) {
    return { score: 'warm', reason: 'OPENAI_API_KEY не настроен — автоклассификация отключена' }
  }

  const prompt = `Ты — аналитик лидов. Оцени ответ потенциального клиента.

КРИТЕРИИ ЗАКАЗЧИКА (что мы ищем):
${criteria}

НАШЕ СООБЩЕНИЕ:
${outboundMsg}

ОТВЕТ ЛИДА:
${inboundReply}

Классифицируй ответ СТРОГО как одно из:
- hot: Лид полностью соответствует критериям, явно заинтересован
- warm: Частично соответствует, есть интерес но нужно дожать
- cold: Минимальный интерес, формальный ответ
- irrelevant: Не соответствует критериям, спам, отказ, негатив

Ответь JSON: {"score": "...", "reason": "краткое объяснение на русском (до 100 символов)"}`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.3,
    max_tokens: 200,
  })

  const content = response.choices[0].message.content
  try {
    return JSON.parse(content)
  } catch {
    return { score: 'warm', reason: 'Ошибка парсинга ответа AI' }
  }
}
