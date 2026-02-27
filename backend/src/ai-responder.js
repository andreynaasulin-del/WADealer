import OpenAI from 'openai'
import 'dotenv/config'

const apiKey = process.env.OPENAI_API_KEY
let openai = null
if (apiKey && apiKey !== 'YOUR_OPENAI_API_KEY') {
  openai = new OpenAI({ apiKey })
}

// ─── Config ──────────────────────────────────────────────────────────────────

/** Max follow-up questions the AI will ask (after the initial campaign message) */
const MAX_FOLLOWUPS = 6

/** Categories we want to extract from conversations */
const CATEGORIES = [
  'location',      // район / адрес / куда приехать
  'price',         // цена за визит/час
  'availability',  // сегодня / когда свободна
  'nationality',   // откуда / национальность
  'photos',        // фото / реальные фото
  'services',      // какие услуги / что входит
]

// ─── System prompt for auto-reply ────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a CLIENT who messaged a girl from her escort advertisement.
You are gathering information step by step, asking ONE short question per message.

YOUR GOAL: Collect all of these data points through natural conversation:
1. LOCATION — where is she located / what area / address
2. PRICE — how much per visit / per hour
3. AVAILABILITY — is she available today / what times
4. NATIONALITY — where is she from (if not mentioned yet)
5. PHOTOS — ask for photos if not sent yet
6. SERVICES — what does she offer / what's included

CRITICAL RULES:
- Ask ONLY ONE question per message
- Keep it SHORT (1-2 sentences max, like a real client texting)
- Sound casual, natural — like a real man texting
- DO NOT repeat questions already answered in the conversation
- If she already told you a detail, acknowledge it briefly and ask the NEXT thing
- Match her language (Hebrew → reply in Hebrew, Russian → Russian, English → English)
- If she sent a price list or full info — respond with something like "ok thanks" or "sounds good, when can I come?"
- If she's rude, says no, or blocks — respond "NULL"
- If ALL 6 data points are collected — respond "NULL"
- If you've already asked 6+ follow-up questions — respond "NULL"
- NEVER reveal you are an AI or a bot
- NEVER mention categories, data collection, or parsing

Style examples (English):
- "nice, what area are you in?"
- "how much for an hour?"
- "are you free tonight?"
- "can you send a photo?"
- "where are you from?"
- "what's included?"

Style examples (Hebrew):
- "באיזה אזור את?"
- "כמה לשעה?"
- "את פנויה היום?"
- "יש תמונות?"
- "מאיפה את?"
- "מה כולל?"

Style examples (Russian):
- "в каком районе?"
- "сколько за час?"
- "сегодня свободна?"
- "фото скинешь?"
- "откуда ты?"
- "что входит?"`

// ─── Generate next auto-reply ─────────────────────────────────────────────────

/**
 * Generate the next follow-up question based on conversation history.
 * Returns null if we should stop (enough questions asked, conversation done).
 *
 * @param {Array<{direction: 'inbound'|'outbound', body: string}>} history
 * @returns {Promise<string|null>}
 */
export async function generateAutoReply(history) {
  if (!openai) return null

  // Count our follow-up messages (excluding the first campaign message)
  const ourMessages = history.filter(m => m.direction === 'outbound')
  if (ourMessages.length > MAX_FOLLOWUPS) return null  // stop after enough questions

  // Build chat messages for GPT
  const chatMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
  ]

  for (const msg of history) {
    chatMessages.push({
      role: msg.direction === 'outbound' ? 'assistant' : 'user',
      content: msg.body,
    })
  }

  chatMessages.push({
    role: 'user',
    content: '(Generate your next short client message. Reply ONLY with the message text, or "NULL" if the conversation is done.)',
  })

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: chatMessages,
      temperature: 0.7,
      max_tokens: 150,
    })

    const reply = response.choices[0].message.content?.trim()

    if (!reply || reply === 'NULL' || reply.toLowerCase() === 'null' || reply.includes('NULL')) {
      return null
    }

    // Clean up: remove quotes if GPT wrapped the message
    let cleaned = reply.replace(/^["']|["']$/g, '').trim()
    if (cleaned.length > 300) cleaned = cleaned.substring(0, 300)  // safety cap

    return cleaned
  } catch (err) {
    console.error('[AI-Responder] Error generating reply:', err.message)
    return null
  }
}

// ─── Extract structured data from conversation ───────────────────────────────

/**
 * Parse conversation and extract structured data for each category.
 * Returns JSON object with filled fields.
 *
 * @param {Array<{direction: 'inbound'|'outbound', body: string}>} history
 * @returns {Promise<Object|null>}
 */
export async function extractConversationData(history) {
  if (!openai || history.length < 3) return null  // need at least 2 exchanges

  const transcript = history.map(m => {
    const who = m.direction === 'outbound' ? 'Client' : 'Girl'
    return `${who}: ${m.body}`
  }).join('\n')

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: `Extract structured data from this escort inquiry conversation.

CONVERSATION:
${transcript}

Extract these fields (use null if not mentioned or unclear):
- location: city/neighborhood/area where she works (string or null)
- price: price info as stated (string like "500 ILS/hour" or null)
- availability: when she's available (string or null)
- nationality: her nationality/origin (string or null)
- has_photos: did she send or offer photos (true/false/null)
- services: what services she offers (brief string or null)
- language: main language of conversation ("hebrew"/"russian"/"english"/"other")
- sentiment: her attitude ("positive"/"neutral"/"negative"/"unresponsive")

Respond with ONLY valid JSON, no markdown.`,
      }],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 400,
    })

    return JSON.parse(response.choices[0].message.content)
  } catch (err) {
    console.error('[AI-Responder] Error extracting data:', err.message)
    return null
  }
}
