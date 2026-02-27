import OpenAI from 'openai'
import 'dotenv/config'

const apiKey = process.env.OPENAI_API_KEY
let openai = null
if (apiKey && apiKey !== 'YOUR_OPENAI_API_KEY') {
  openai = new OpenAI({ apiKey })
}

// ─── Config ──────────────────────────────────────────────────────────────────

/** Model for conversation (configurable via env) */
const CHAT_MODEL = process.env.AI_CHAT_MODEL || 'gpt-4o'

/** Model for data extraction */
const EXTRACT_MODEL = process.env.AI_EXTRACT_MODEL || 'gpt-4o'

/** Max follow-up messages we send (excluding the initial campaign message) */
const MAX_FOLLOWUPS = 6

/** Categories we extract */
const CATEGORIES = ['location', 'price', 'availability', 'nationality', 'photos', 'services']

/**
 * Build token-limit param compatible with both GPT-4o (max_tokens) and GPT-5.x (max_completion_tokens).
 * GPT-5.x rejects 'max_tokens' — must use 'max_completion_tokens'.
 */
function tokenLimitParam(model, limit) {
  if (model.startsWith('gpt-5') || model.startsWith('o1') || model.startsWith('o3') || model.startsWith('o4')) {
    return { max_completion_tokens: limit }
  }
  return { max_tokens: limit }
}

// ─── System prompt — structured analysis approach ───────────────────────────

const SYSTEM_PROMPT = `You are a REAL GUY — a confident, warm, slightly flirty male client chatting with a girl on WhatsApp after seeing her escort ad.
You're genuinely interested in her. You text like a real man — short, warm, with compliments and light flirting. NOT like a robot asking dry questions.

## YOUR PERSONALITY:
- Warm and charming — use pet names: "מותק" (motek), "יפה" (yafa), "красотка", "sweetie", "babe"
- React to photos with genuine excitement: "ואוו את ממש יפה 😍", "горячая 🔥", "wow you look amazing"
- Thank her warmly: "תודה מותק", "спасибо красотка"
- Light flirting: "can't wait to see you", "אני כבר מתרגש", "ты просто огонь"
- Mix your question INTO a warm message, don't just ask dry questions
- Sound like a real horny guy who's excited, not a surveyor filling out a form

## EXAMPLES OF GOOD vs BAD:
❌ BAD (robot): "what is your location?"
✅ GOOD: "את באיזה אזור מותק?"
❌ BAD: "how much for an hour?"
✅ GOOD: "כמה לשעה יפה שלי?"
❌ BAD: "can you send a photo?"
✅ GOOD: "יש לך עוד תמונות? 😏"
❌ BAD (on receiving photos): "nice, what area are you in?"
✅ GOOD: "ואוו את חתיכה רצינית 🔥 איפה את נמצאת?"
❌ BAD: "are you free tonight?"
✅ GOOD: "פנויה הלילה מותק? הייתי שמח לבוא"

## BEFORE YOU REPLY — MANDATORY ANALYSIS

Read the ENTIRE conversation. For each category, check if she ALREADY provided info:
- location: city, area, neighborhood, or address
- price: any mention of cost
- availability: when she can meet
- nationality: where she's from
- photos: did she send photos/videos/media (look for "[MEDIA]" tags)
- services: what she offers

## DECISION LOGIC

Return JSON:
{
  "analysis": {
    "location": "<what she said or null>",
    "price": "<what she said or null>",
    "availability": "<what she said or null>",
    "nationality": "<what she said or null>",
    "photos": "<sent/offered/not yet>",
    "services": "<what she said or null>"
  },
  "filled": <number of non-null fields>,
  "questions_i_asked": ["topics I already asked about"],
  "duplicates_found": <true if I sent same message twice>,
  "her_last_message_answered": "<topic or 'unrelated'>",
  "should_stop": <true/false>,
  "stop_reason": "<why or null>",
  "reply": "<your message or NULL>"
}

## WHEN TO STOP (should_stop=true, reply=NULL):
- filled >= 4 → enough data, say something warm like "תודה מותק, נתראה 😘" then STOP
- 5+ follow-up messages sent → STOP
- Duplicate messages in history → STOP
- She's angry/rude/ignoring → STOP
- She gave 3+ data points at once → warm "thanks beautiful" then STOP

## REPLY RULES:
- 1-2 short sentences MAX (like real WhatsApp texting)
- Match her language EXACTLY (Hebrew → Hebrew, Russian → Russian, English → English)
- ALWAYS include warmth/flirtiness — never a dry question alone
- If she sent photos/media → ALWAYS compliment first ("ואוו 🔥", "hot 😍") before asking anything
- If she gave info → acknowledge warmly BEFORE asking next thing ("nice motek, and how much?")
- NEVER repeat a question (check questions_i_asked)
- NEVER ask what she already told you (check analysis)
- NEVER reveal you're AI/bot
- NEVER use formal language — be casual, short, real`

// ─── Generate next auto-reply ─────────────────────────────────────────────────

/**
 * Generate the next follow-up based on conversation history.
 * Returns null if we should stop (enough data, conversation done, duplicates detected).
 *
 * @param {Array<{direction: 'inbound'|'outbound', body: string}>} history
 * @returns {Promise<string|null>}
 */
export async function generateAutoReply(history) {
  if (!openai) return null

  // ── Hard limits (before calling API) ─────────────────────────────────────
  const ourMessages = history.filter(m => m.direction === 'outbound')

  // Too many messages sent → stop
  if (ourMessages.length >= MAX_FOLLOWUPS + 1) return null

  // STRICT duplicate detection: if ANY outbound message appears 2+ times → stop
  // (was 3+ but that allowed 2 dupes which is already spam)
  const msgCounts = new Map()
  for (const m of ourMessages) {
    const key = m.body?.toLowerCase().trim()
    if (key) msgCounts.set(key, (msgCounts.get(key) || 0) + 1)
  }
  for (const [msg, count] of msgCounts.entries()) {
    if (count >= 2) {
      console.log(`[AI-Responder] DUPE x${count}: "${msg.substring(0, 50)}" — blocking`)
      return null
    }
  }

  // ── Format transcript ────────────────────────────────────────────────────
  const transcript = history.map(m => {
    const who = m.direction === 'outbound' ? 'You (client)' : 'Her'
    let content = m.body
    // Replace media markers with human-readable tags
    if (content?.startsWith('[media:')) {
      content = '[MEDIA: She sent a photo/video file]'
    }
    return `${who}: ${content}`
  }).join('\n')

  try {
    const response = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `CONVERSATION TRANSCRIPT:\n${transcript}\n\nAnalyze this conversation and decide your next action. Reply ONLY with valid JSON.`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.4,
      ...tokenLimitParam(CHAT_MODEL, 600),
    })

    const raw = response.choices[0].message.content?.trim()
    if (!raw) return null

    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      // JSON parse failed — if raw looks like NULL, stop
      if (raw.toUpperCase().includes('NULL')) return null
      // Otherwise try to use it as plain text (shouldn't happen with json mode)
      console.log('[AI-Responder] JSON parse failed, raw:', raw.substring(0, 100))
      return null
    }

    // ── Validate structured response ─────────────────────────────────────
    const reply = parsed.reply?.trim()

    // Model decided to stop
    if (!reply || reply === 'NULL' || reply.toUpperCase() === 'NULL' || parsed.should_stop) {
      return null
    }

    // Safety: if model says 4+ fields collected, stop regardless
    if (parsed.filled >= 4) return null

    // Safety: if duplicates found, stop
    if (parsed.duplicates_found) return null

    // Safety: reply must not match any of our previous messages (exact OR fuzzy)
    const replyLower = reply.toLowerCase().trim()
    const replyWords = new Set(replyLower.replace(/[?!.,]/g, '').split(/\s+/).filter(w => w.length > 2))
    for (const m of ourMessages) {
      const prev = m.body?.toLowerCase().trim()
      if (!prev) continue
      // Exact match
      if (prev === replyLower) {
        console.log('[AI-Responder] Reply matches a previous message (exact), blocking')
        return null
      }
      // Fuzzy match: if 70%+ of words overlap → same question rephrased
      const prevWords = new Set(prev.replace(/[?!.,]/g, '').split(/\s+/).filter(w => w.length > 2))
      if (replyWords.size >= 2 && prevWords.size >= 2) {
        const overlap = [...replyWords].filter(w => prevWords.has(w)).length
        const similarity = overlap / Math.max(replyWords.size, prevWords.size)
        if (similarity >= 0.7) {
          console.log(`[AI-Responder] Reply too similar to previous (${(similarity * 100).toFixed(0)}%): "${prev.substring(0, 40)}" vs "${replyLower.substring(0, 40)}"`)
          return null
        }
      }
    }

    // Clean up
    let cleaned = reply.replace(/^["']|["']$/g, '').trim()
    if (cleaned.length > 200) cleaned = cleaned.substring(0, 200)

    return cleaned
  } catch (err) {
    console.error('[AI-Responder] Error:', err.message)
    return null
  }
}

// ─── Extract structured data from conversation ───────────────────────────────

/**
 * Parse conversation and extract structured data.
 * @param {Array<{direction: 'inbound'|'outbound', body: string}>} history
 * @returns {Promise<Object|null>}
 */
export async function extractConversationData(history) {
  if (!openai || history.length < 3) return null

  const transcript = history.map(m => {
    const who = m.direction === 'outbound' ? 'Client' : 'Girl'
    let content = m.body
    if (content?.startsWith('[media:')) {
      content = '[MEDIA FILE SENT]'
    }
    return `${who}: ${content}`
  }).join('\n')

  try {
    const response = await openai.chat.completions.create({
      model: EXTRACT_MODEL,
      messages: [{
        role: 'user',
        content: `Extract structured data from this escort inquiry conversation.

CONVERSATION:
${transcript}

Extract these fields (use null if not mentioned or unclear):
- location: city/neighborhood/area/address where she works (string or null)
- price: price info as stated by her (string like "500 ILS/hour" or null)
- availability: when she's available (string or null)
- nationality: her nationality/origin (string or null)
- has_photos: did she send or offer photos/media (true/false/null)
- services: what services she offers (brief string or null)
- language: main language of conversation ("hebrew"/"russian"/"english"/"other")
- sentiment: her attitude ("positive"/"neutral"/"negative"/"unresponsive")

Respond with ONLY valid JSON, no markdown.`,
      }],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      ...tokenLimitParam(EXTRACT_MODEL, 400),
    })

    return JSON.parse(response.choices[0].message.content)
  } catch (err) {
    console.error('[AI-Responder] Extraction error:', err.message)
    return null
  }
}
