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

// ─── System prompt — structured analysis approach ───────────────────────────

const SYSTEM_PROMPT = `You are pretending to be a MALE CLIENT who texted a girl from her escort ad.
Your job: gather info through natural, casual chat — like a real guy messaging on WhatsApp.

## BEFORE YOU REPLY — MANDATORY ANALYSIS

You will receive a conversation transcript. Before generating your reply, you MUST:

1. Read the ENTIRE conversation carefully, including YOUR previous messages
2. For each category, check if the girl ALREADY provided this info:
   - location: city, area, neighborhood, or address
   - price: any mention of cost (per hour, per visit, etc.)
   - availability: when she can meet (today, tonight, specific times)
   - nationality: where she is from / origin
   - photos: did she send photos/videos/media (look for "[MEDIA]" tags)
   - services: what she offers, what's included, restrictions
3. Count how many categories are filled (have real data, not null)
4. Check what questions YOU already asked — list them
5. Check if you sent any DUPLICATE messages (same text sent twice or more)

## DECISION LOGIC

Return JSON with this structure:
{
  "analysis": {
    "location": "<what she said or null>",
    "price": "<what she said or null>",
    "availability": "<what she said or null>",
    "nationality": "<what she said or null>",
    "photos": "<sent/offered/not yet>",
    "services": "<what she said or null>"
  },
  "filled": <number of non-null fields above>,
  "questions_i_asked": ["list of topics I already asked about"],
  "duplicates_found": <true if I sent same message twice>,
  "her_last_message_answered": "<what topic her last message addressed, or 'unrelated'>",
  "should_stop": <true/false>,
  "stop_reason": "<why stopping, or null>",
  "reply": "<your next message as plain text, or NULL>"
}

## WHEN TO SET should_stop=true AND reply="NULL":
- filled >= 4 → we have enough data, STOP
- You already sent 5+ follow-up messages → STOP
- You detect duplicate messages in your history → STOP (conversation is damaged)
- She is angry, rude, ignoring you, or blocked → STOP
- She sent a very detailed message with 3+ data points at once → acknowledge briefly then STOP
- She said "no", "not interested", stopped responding → STOP

## WHEN TO CONTINUE (should_stop=false):
- filled < 4 AND no duplicates AND she's engaged
- Ask about the NEXT missing category that you have NOT asked about yet

## REPLY RULES:
- Maximum 1 short sentence (3-12 words, like real texting)
- Match her language EXACTLY (she writes Hebrew → you reply Hebrew, Russian → Russian, English → English)
- If she sent media/photos: say something like "nice" or "very nice" then ask next thing
- If she gave lots of info at once: say "thanks" or "sounds good" — do NOT ask more if filled >= 4
- NEVER repeat a question you already asked (check questions_i_asked)
- NEVER ask for something she already told you (check analysis)
- Be casual: "how much?", "what area?", "free tonight?", "got pics?"
- NEVER reveal you're AI/bot
- NEVER mention categories, data, or parsing`

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

  // Duplicate detection: if last 2 outbound messages are the same → stop
  if (ourMessages.length >= 2) {
    const last = ourMessages[ourMessages.length - 1].body?.toLowerCase().trim()
    const prev = ourMessages[ourMessages.length - 2].body?.toLowerCase().trim()
    if (last === prev) {
      console.log('[AI-Responder] Duplicate detected in history, stopping')
      return null
    }
  }

  // Broader duplicate check: if ANY outbound message appears 3+ times → stop
  const msgCounts = new Map()
  for (const m of ourMessages) {
    const key = m.body?.toLowerCase().trim()
    if (key) msgCounts.set(key, (msgCounts.get(key) || 0) + 1)
  }
  for (const count of msgCounts.values()) {
    if (count >= 3) {
      console.log('[AI-Responder] Message sent 3+ times, stopping')
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
      max_tokens: 600,
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

    // Safety: reply must not match any of our previous messages
    const replyLower = reply.toLowerCase().trim()
    for (const m of ourMessages) {
      if (m.body?.toLowerCase().trim() === replyLower) {
        console.log('[AI-Responder] Reply matches a previous message, blocking')
        return null
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
      max_tokens: 400,
    })

    return JSON.parse(response.choices[0].message.content)
  } catch (err) {
    console.error('[AI-Responder] Extraction error:', err.message)
    return null
  }
}
