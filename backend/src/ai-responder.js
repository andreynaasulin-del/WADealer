import OpenAI from 'openai'
import 'dotenv/config'

// ─── API client — supports xAI (Grok) with OpenAI SDK ───────────────────────
const xaiKey = process.env.XAI_API_KEY
const openaiKey = process.env.OPENAI_API_KEY
const apiKey = xaiKey || openaiKey
let openai = null
if (apiKey && apiKey !== 'YOUR_OPENAI_API_KEY') {
  openai = new OpenAI({
    apiKey,
    baseURL: xaiKey ? (process.env.XAI_BASE_URL || 'https://api.x.ai/v1') : undefined,
  })
}

// ─── Config ──────────────────────────────────────────────────────────────────

/** Model for conversation (configurable via env) */
const CHAT_MODEL = process.env.AI_CHAT_MODEL || (xaiKey ? 'grok-4-1-fast-non-reasoning' : 'gpt-4o')

/** Model for data extraction */
const EXTRACT_MODEL = process.env.AI_EXTRACT_MODEL || (xaiKey ? 'grok-4-1-fast-non-reasoning' : 'gpt-4o')

/** Max follow-up messages we send per conversation (excluding the initial campaign message) */
const MAX_FOLLOWUPS = 15

/** ALL required fields — the 7 MUST-HAVE fields + video */
const CATEGORIES = [
  'address',        // exact address (street + number + city)
  'city',           // city name
  'prices',         // price list with durations
  'nationality',    // nationality/ethnicity
  'incall_outcall', // к себе / по вызову / оба
  'independent',    // индивидуалка или агентство
  'photos',         // real photos (3+)
  'video',          // at least 1 real video
]

/**
 * Build token-limit param compatible with both GPT-4o (max_tokens) and GPT-5.x (max_completion_tokens).
 * GPT-5.x rejects 'max_tokens' — must use 'max_completion_tokens'.
 */
function tokenLimitParam(model, limit) {
  // GPT-5.x and o-series use max_completion_tokens; Grok and GPT-4o use max_tokens
  if (model.startsWith('gpt-5') || model.startsWith('o1') || model.startsWith('o3') || model.startsWith('o4')) {
    return { max_completion_tokens: limit }
  }
  return { max_tokens: limit }
}

// ─── System prompt — structured analysis approach ───────────────────────────

// ─── INVITATION CAMPAIGN — girl-to-girl, inviting to tahles.top ─────────────

/** Build invitation prompt dynamically with the specific profile URL */
function buildInvitationPrompt(profileUrl) {
  const url = profileUrl || 'tahles.top'
  return `You are a REAL GIRL who works as an escort in Israel. You're chatting on WhatsApp with a potential CLIENT (man) to attract him to your profile.

## YOUR PERSONA:
- You are a real working girl, sweet and flirty
- You recently LOWERED your prices significantly — this is your main hook
- You added NEW hot photos recently — unique, sexy content
- You have a profile with all your info, photos and prices: ${url}
- You're reaching out to potential clients you found online

## YOUR STORY (use naturally in conversation):
- "I just lowered my prices, it's a great time"
- "I added crazy new photos recently 🔥"
- "Check my profile — everything is there: ${url}"
- You are sweet, flirty, inviting — like a girl who wants to attract a client

## CONVERSATION GOALS (in order):
1. GRAB ATTENTION — short flirty opener, NO link in the first AI reply
2. ENGAGE — if he responds, build curiosity, tease
3. DRIVE TO SITE — send him the link ${url} when he shows interest or asks
4. ANSWER QUESTIONS — if he asks about prices, location, services → redirect to ${url}
5. PUSH HARDER — "I just uploaded a video too 🔥", "special price only today", "I'm free right now"
6. CLOSE — "come see me" / "check my profile"

## CRITICAL RULES:

### LANGUAGE & GENDER:
- MATCH HIS LANGUAGE. He writes Hebrew → reply Hebrew. Russian → Russian. English → English.
- The person you're texting is ALWAYS A MAN. Use MASCULINE forms ONLY:
  - Hebrew: "תיכנס" NOT "תיכנסי", "חמוד" NOT "חמודה", "תראה" NOT "תראי", "אתה" NOT "את", "בוא" NOT "בואי", "תסתכל" NOT "תסתכלי"
  - Russian: use "милый", "красавчик", "дорогой" — NEVER feminine forms
  - English: "handsome", "babe", "sweetie"
- Hebrew pet names: "מותק", "חיים שלי", "נשמה", "בוא תראה"
- Russian: "милый", "красавчик", "солнце", "зайди посмотри"

### LINK RULES:
0. If he says "שלח לכאן", "שלחי לכאן", "תשלח", "send here", "пришли сюда", "скинь сюда", "תשלח לי", "שלח לי" — send the link ${url} IMMEDIATELY like "הנה מותק 😘 ${url}" or "вот, смотри 😘 ${url}".
1. NEVER put the link in your FIRST AI reply. First message = text only, build curiosity.
2. Starting from 2nd message: include ${url} when he asks for details/prices/photos, or when redirecting after teasing.
3. When mentioning your profile/page — ALWAYS include the full link: ${url}. NEVER say just "my profile" without the actual URL.
4. Don't spam ${url} in EVERY message. Alternate: text-only tease → link message → text-only → etc.

### STYLE RULES:
- 1-2 SHORT sentences max. Real WhatsApp style. No essays.
- NEVER reveal you're a bot/AI.
- NEVER say "אני בחורה" or "я девушка" — it sounds robotic.
- NO empty filler chat. Every message must either build curiosity, send the link, or close.
- Be PERSISTENT but not desperate. If he ignores, try a different angle. Only give up after 3+ ignored.
- Create URGENCY: "prices going back up soon", "I'm only here for a few days"
- Create CURIOSITY: "you won't believe the photos 😏"

## BANNED WORDS — NEVER USE THESE:
- "מלחמה" (war), "מבצע" (deal/sale), "מקלט" (bomb shelter), "בומבה" (bomb), "מלחמת" (war-)
- "война", "акция", "бомбоубежище", "бомба", "скидка"
- "war", "operation", "bomb shelter", "sale", "discount"
- "אני בחורה" (I'm a girl), "я девушка" (I'm a girl)

## BEFORE YOU REPLY — ANALYZE:

Check conversation stage:
- attention_grabbed: did he respond? (true/false)
- interest_level: "hot" / "warm" / "cold" / "refused"
- asked_about: what did he ask? (prices/photos/location/services/null)
- link_sent: was ${url} already sent in this conversation? (check transcript)
- should_stop: true if he refused, asked to stop, or conversation is done

## RESPONSE FORMAT — JSON only:
{
  "analysis": {
    "attention_grabbed": true/false,
    "interest_level": "<hot/warm/cold/refused>",
    "asked_about": "<prices/photos/location/services/null>",
    "link_sent": true/false
  },
  "stage": "<attention/teasing/redirect/closing>",
  "should_stop": false,
  "reply": "<your message in HIS language>"
}

## WHEN TO STOP (should_stop=true, reply=null):
- He explicitly said "stop", "don't write me", "leave me alone", "blocked"
- He visited the site and confirmed (SUCCESS!)
- 8+ messages from us without ANY response at all
- He's being threatening or extremely aggressive

## WHEN NOT TO STOP:
- "not interested" / "no thanks" → try ONE more angle with urgency/curiosity
- "who are you?" → introduce yourself flirtily, then offer the link
- "?" or "what" → he's engaged, keep going
- Asked about prices/location → redirect to ${url}
- 1-2 messages no response → try a different hook
- Confused ("מה?", "מי את?", "кто ты?") — ONE casual reply, then ALWAYS send ${url} next message

## CONVERSATION FLOW EXAMPLES:

Hebrew:
You: "היי מותק, הורדתי מחירים לאחרונה ויש לי תמונות חדשות מטורפות 🔥"
Him: "מי את?"
You: "אני עובדת באזור, יש לי אנקטה עם הכל — תמונות, מחירים 😘"
Him: "כמה עולה?"
You: "הכל באנקטה חמוד 👉 ${url}"
Him: "שלח לכאן"
You: "הנה מותק 😘 ${url}"
Him: "יש תמונות?"
You: "ברור שיש! תיכנס תראה 😏 ${url}"

Russian:
You: "Привет красавчик, скинула цены недавно и добавила новые фотки 🔥"
Him: "Ты кто?"
You: "Работаю тут, если интересно — скину ссылку на анкету 😘"
Him: "Сколько стоит?"
You: "Всё на анкете, милый 👉 ${url} — там и фото и цены"
Him: "Скинь сюда"
You: "Вот, смотри 😘 ${url}"

## DO NOT:
- Send link in the FIRST AI reply — build curiosity first
- Send any links other than ${url}
- Give specific prices in chat (redirect to profile)
- Send explicit content
- Be desperate or beg
- Use ANY banned words (see list above)
- Say "אני בחורה" or "я девушка"
- Use feminine forms (תיכנסי, חמודה, תראי, etc.)
- Send empty filler messages without purpose`
}

const SYSTEM_PROMPT = `You are a REAL GUY chatting with a girl on WhatsApp. You saw her ad and you're interested. You text like a normal man — short, warm, flirty.

## 7 MUST-HAVE FIELDS (collect ALL before stopping):
1. ADDRESS — exact address (street + number + city), NOT just "Tel Aviv"
2. PRICE — price list (30min, 1h, 2h, night)
3. CITY — which city she works in
4. NATIONALITY — ethnicity (Brazilian, Russian, Israeli, etc.)
5. INCALL/OUTCALL — к себе (at her place), по вызову (comes to you), or both
6. INDEPENDENT/AGENCY — works alone (индивидуалка) or with an agency
7. PHOTOS — she must send at least 3 real photos

## BONUS — TRY TO GET:
8. VIDEO — ask for at least 1 short video ("можешь скинуть короткое видео?")

## CRITICAL RULES:
- MATCH HER LANGUAGE. She writes Hebrew → reply Hebrew. Russian → Russian. English → English.
- Sound like a REAL CLIENT, not a robot or a survey. Be warm, flirty, use pet names natural to the conversation language.
- Hebrew: "מותק", "יפה שלי", "את נשמעת מדהימה"
- Russian: "малышка", "милашка", "красивая", "зай"
- English: "babe", "sweetie", "gorgeous"
- 1-2 SHORT sentences max. Like a real WhatsApp text, not an essay.
- ALWAYS wrap your question inside a warm/flirty message. Never a dry question alone.
- If she sent photos/video → compliment FIRST, then ask next missing field.
- NEVER repeat a question you already asked.
- NEVER reveal you're a bot/AI.

## BEFORE YOU REPLY — ANALYZE:

Check what she already provided:
- address: exact address (street+number+city) or null
- city: city name or null
- prices: price list or null
- nationality: ethnicity or null
- incall_outcall: "incall"/"outcall"/"both" or null
- independent: "independent"/"agency" or null
- photos: count of photos she sent (look for "[media:" or "[MEDIA]" tags) or 0
- video: did she send video (look for "[media:video" tags) or false

## RESPONSE FORMAT — JSON only:
{
  "analysis": {
    "address": "<value or null>",
    "city": "<value or null>",
    "prices": "<value or null>",
    "nationality": "<value or null>",
    "incall_outcall": "<incall/outcall/both or null>",
    "independent": "<independent/agency or null>",
    "photos": "<count or 0>",
    "video": "<true/false>"
  },
  "filled": <number of non-null fields out of 7 essentials>,
  "next_missing": "<most important missing field>",
  "should_stop": false,
  "reply": "<your message in HER language>"
}

## WHEN TO STOP (should_stop=true, reply=null):
- filled >= 7 (all essential data collected) → warm goodbye
- 12+ follow-ups and she stopped giving info → STOP
- She's angry / blocked / says go away → STOP
- Duplicate messages detected → STOP

## DO NOT STOP if filled < 7. KEEP ASKING about next_missing.
- City but no exact address? → "а точный адрес можешь скинуть?"
- Only 1h price? → "а на полчаса/два часа сколько?"
- No photos yet? → "скинь пару фоток, хочу посмотреть на тебя 😏"
- Got photos but no video? → "а видео есть? хоть коротенькое"
- Didn't say incall/outcall? → "ты принимаешь или выезжаешь?"
- Didn't say independent/agency? → ask naturally if she works alone`

// ─── Fallback messages when AI model refuses to reply ─────────────────────────

const FALLBACK_MESSAGES = {
  address: {
    he: ['מותק, מה הכתובת המדויקת שלך? 😘', 'יפה שלי, איפה בדיוק את? רחוב ומספר?'],
    ru: ['Малышка, а точный адрес можешь скинуть? 😘', 'Красивая, а где ты находишься? Улица и номер дома?'],
    en: ['Babe, what\'s your exact address? 😘', 'Sweetie, where exactly are you located? Street and number?'],
  },
  city: {
    he: ['באיזה עיר את מותק? 😊', 'את באיזה אזור יפה שלי?'],
    ru: ['А в каком городе ты, милашка? 😊', 'Красивая, в каком ты городе?'],
    en: ['Which city are you in, gorgeous? 😊', 'What city are you based in, sweetie?'],
  },
  prices: {
    he: ['מה המחירים שלך מותק? לחצי שעה, שעה? 😘', 'כמה לשעה יפה שלי?'],
    ru: ['А сколько стоит, малышка? За полчаса, час? 😘', 'Красивая, какие цены?'],
    en: ['What are your prices, babe? For 30min, 1h? 😘', 'How much for an hour, gorgeous?'],
  },
  nationality: {
    he: ['מאיפה את מותק? 😊', 'את מקומית או מחו"ל יפה שלי?'],
    ru: ['Откуда ты родом, малышка? 😊', 'А какой ты национальности, красивая?'],
    en: ['Where are you from originally, babe? 😊', 'What\'s your nationality, gorgeous?'],
  },
  incall_outcall: {
    he: ['את מקבלת אצלך או יוצאת מותק? 😘', 'יש אפשרות גם לצאת אליי?'],
    ru: ['Ты принимаешь у себя или выезжаешь, милашка? 😘', 'К тебе или по вызову, красивая?'],
    en: ['Do you host or travel, sweetie? 😘', 'Incall or outcall, babe?'],
  },
  independent: {
    he: ['את עובדת לבד מותק? 😊', 'את עצמאית או עם סוכנות יפה שלי?'],
    ru: ['Ты работаешь сама, малышка? 😊', 'Ты индивидуалка или через агентство?'],
    en: ['Do you work independently, babe? 😊', 'Are you independent or with an agency, sweetie?'],
  },
  photos: {
    he: ['יש לך תמונות לשלוח מותק? רוצה לראות אותך 😏', 'שלחי לי כמה תמונות יפה שלי 📷'],
    ru: ['Скинь пару фоток, хочу посмотреть на тебя 😏', 'Малышка, есть фото? 📷'],
    en: ['Can you send me some photos, gorgeous? 😏', 'I\'d love to see some pics of you, babe 📷'],
  },
  video: {
    he: ['יש לך סרטון קצר מותק? 😏', 'את יכולה לשלוח וידאו קצר יפה שלי?'],
    ru: ['А видео есть? Хоть коротенькое, малышка 😏', 'Можешь скинуть короткое видео, красивая?'],
    en: ['Got a short video, babe? 😏', 'Can you send a quick video, gorgeous?'],
  },
}

/**
 * Detect conversation language from last inbound messages.
 */
function _detectLanguage(history) {
  const inbound = history.filter(m => m.direction === 'inbound').map(m => m.body || '')
  const text = inbound.slice(-3).join(' ')
  // Hebrew characters
  if (/[\u0590-\u05FF]/.test(text)) return 'he'
  // Russian characters
  if (/[\u0400-\u04FF]/.test(text)) return 'ru'
  return 'en'
}

/**
 * Build a fallback message when AI model refuses to continue but fields are missing.
 */
function _buildFallbackMessage(nextMissing, analysis, history) {
  const lang = _detectLanguage(history)
  const field = nextMissing || _findFirstMissing(analysis)
  const templates = FALLBACK_MESSAGES[field]
  if (!templates) return null
  const msgs = templates[lang] || templates.en
  return msgs[Math.floor(Math.random() * msgs.length)]
}

function _findFirstMissing(analysis) {
  if (!analysis) return 'prices'
  const checks = [
    ['address', v => v && v !== 'null'],
    ['city', v => v && v !== 'null'],
    ['prices', v => v && v !== 'null'],
    ['nationality', v => v && v !== 'null'],
    ['incall_outcall', v => v && v !== 'null'],
    ['independent', v => v && v !== 'null'],
    ['photos', v => v && v !== '0' && v !== 0 && v !== 'not yet'],
  ]
  for (const [field, check] of checks) {
    if (!check(analysis[field])) return field
  }
  return 'video' // all 7 filled, try bonus
}

// ─── Post-generation safety filters ──────────────────────────────────────────

/** Banned words — if ANY found in reply, reject it entirely */
const BANNED_WORD_PATTERNS = [
  /מלחמ[הת]/,        // מלחמה, מלחמת (war)
  /מבצע/,             // מבצע (deal/operation)
  /מקלט/,             // מקלט (bomb shelter)
  /בומב[האַ]/,        // בומבה (bomb)
  /אני בחורה/,        // אני בחורה (I'm a girl)
  /войн[аыуе]/i,      // война (war)
  /акци[яюией]/i,     // акция (sale)
  /бомб/i,            // бомба, бомбоубежище
  /скидк/i,           // скидка (discount)
  /я девушка/i,       // я девушка (I'm a girl)
  /\bwar\b/i,         // war (English, word boundary to avoid "warm")
  /\bsale\b/i,        // sale
  /\bbomb\s*shelter/i, // bomb shelter
  /\bdiscount\b/i,    // discount
]

/** Feminine→Masculine Hebrew replacements for invitation mode */
const FEMININE_TO_MASCULINE = [
  [/תיכנסי/g, 'תיכנס'],
  [/תראי/g, 'תראה'],
  [/תסתכלי/g, 'תסתכל'],
  [/חמודה/g, 'חמוד'],
  [/בואי/g, 'בוא'],
  [/תשלחי/g, 'תשלח'],
  [/תעשי/g, 'תעשה'],
  [/תגידי/g, 'תגיד'],
  [/תרצי/g, 'תרצה'],
  [/תכתבי/g, 'תכתוב'],
  [/יפה שלי/g, 'חמוד שלי'],
]

/**
 * Sanitize AI reply: check banned words, fix feminine forms.
 * Returns cleaned reply or null if reply contains banned content.
 */
function _sanitizeReply(reply, isInvitation) {
  if (!reply) return null

  // Check for banned words — reject entire reply
  for (const pattern of BANNED_WORD_PATTERNS) {
    if (pattern.test(reply)) {
      console.log(`[AI-FILTER] BLOCKED reply containing banned word: ${pattern} → "${reply.substring(0, 80)}"`)
      return null
    }
  }

  // For invitation campaigns: replace feminine forms with masculine
  if (isInvitation) {
    let fixed = reply
    for (const [feminine, masculine] of FEMININE_TO_MASCULINE) {
      if (feminine.test(fixed)) {
        console.log(`[AI-FILTER] Replacing feminine form: ${feminine} → ${masculine}`)
        fixed = fixed.replace(feminine, masculine)
      }
    }
    return fixed
  }

  return reply
}

// ─── Generate next auto-reply ─────────────────────────────────────────────────

/**
 * Generate the next follow-up based on conversation history.
 * Returns null if we should stop (enough data, conversation done, duplicates detected).
 *
 * @param {Array<{direction: 'inbound'|'outbound', body: string}>} history
 * @param {Object} [options] - Optional settings
 * @param {string} [options.campaignType] - 'invitation' for tahles.top invites, default = data collection
 * @returns {Promise<string|null>}
 */
export async function generateAutoReply(history, options = {}) {
  if (!openai) return null

  const isInvitation = options.campaignType === 'invitation'

  // ── Hard limits (before calling API) ─────────────────────────────────────
  const ourMessages = history.filter(m => m.direction === 'outbound')

  // Too many messages sent → stop (invitation campaigns have lower limit)
  const maxFollowups = isInvitation ? 10 : MAX_FOLLOWUPS
  if (ourMessages.length >= maxFollowups + 1) return null

  // STRICT duplicate detection: if ANY outbound message appears 2+ times → stop
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

  // ── Choose system prompt and transcript labels based on campaign type ───
  const systemPrompt = isInvitation ? buildInvitationPrompt(options.profileUrl) : SYSTEM_PROMPT
  const youLabel = isInvitation ? 'You (girl)' : 'You (client)'
  const herLabel = isInvitation ? 'Him' : 'Her'

  // ── Format transcript ────────────────────────────────────────────────────
  const transcript = history.map(m => {
    const who = m.direction === 'outbound' ? youLabel : herLabel
    let content = m.body
    // Replace media markers with human-readable tags
    if (content?.startsWith('[media:')) {
      content = isInvitation
        ? '[MEDIA: He sent a photo/video file]'
        : '[MEDIA: She sent a photo/video file]'
    }
    return `${who}: ${content}`
  }).join('\n')

  try {
    const response = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `CONVERSATION TRANSCRIPT:\n${transcript}\n\nAnalyze this conversation and decide your next action. Reply ONLY with valid JSON.`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: isInvitation ? 0.5 : 0.4,
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
      console.log('[AI-Responder] JSON parse failed, raw:', raw.substring(0, 100))
      return null
    }

    // ── Debug: log AI decision ──────────────────────────────────────────
    if (isInvitation) {
      console.log(`[AI-INVITE] stage=${parsed.stage} interest=${parsed.analysis?.interest_level} stop=${parsed.should_stop} reply="${(parsed.reply || 'NULL').substring(0, 60)}"`)
    } else {
      console.log(`[AI] filled=${parsed.filled}/7 stop=${parsed.should_stop} next=${parsed.next_missing} reply="${(parsed.reply || 'NULL').substring(0, 60)}"`)
    }

    // ── Validate structured response ─────────────────────────────────────
    const reply = parsed.reply?.trim()

    // ── Invitation campaign: simpler stop logic ───────────────────────────
    if (isInvitation) {
      if (parsed.should_stop) {
        console.log(`[AI-INVITE] Conversation done — stopping`)
        return null
      }
      const noReply = !reply || reply === 'NULL' || reply.toUpperCase() === 'NULL'
      if (noReply) return null

      // Safety: check dupe
      const replyLower = reply.toLowerCase().trim()
      for (const m of ourMessages) {
        if (m.body?.toLowerCase().trim() === replyLower) return null
      }

      let cleaned = reply.replace(/^["']|["']$/g, '').trim()
      if (cleaned.length > 300) cleaned = cleaned.substring(0, 300)

      // Run safety filters (banned words + feminine forms)
      cleaned = _sanitizeReply(cleaned, true)
      if (!cleaned) {
        console.log(`[AI-INVITE] Reply blocked by safety filter — skipping`)
        return null
      }

      // HARD RULE: link tahles.top максимум 1 раз за ВЕСЬ диалог
      // Если мы уже отправляли ссылку ранее — вырезаем её из нового сообщения
      const linkAlreadySent = ourMessages.some(m =>
        m.body?.toLowerCase().includes('tahles.top') || m.body?.match(/https?:\/\/\S*tahles/i)
      )
      if (linkAlreadySent) {
        const before = cleaned
        cleaned = cleaned.replace(/https?:\/\/\S+/gi, '').replace(/tahles\.top\S*/gi, '').replace(/\s{2,}/g, ' ').trim()
        if (before !== cleaned) {
          console.log(`[AI-INVITE] STRIPPED duplicate link (already sent once): "${before.substring(0, 80)}" → "${cleaned.substring(0, 80)}"`)
        }
        // If stripping made it empty, replace with a nudge without link
        if (!cleaned || cleaned.replace(/[\s\p{Emoji}]/gu, '').length < 5) {
          cleaned = 'נו מה, נכנסת לראות? 😘'
          console.log(`[AI-INVITE] Replaced link-only dupe with nudge`)
        }
      }

      return cleaned
    }

    // ── Data collection campaign: original logic ──────────────────────────
    // ONLY stop when ALL 7 essential fields collected — IGNORE model's should_stop if filled < 7
    if (parsed.filled >= 7) {
      console.log(`[AI] ALL 7 fields collected — stopping`)
      return null
    }

    // Model says stop OR gave no reply, but we don't have 7 fields — generate fallback
    const noReply = !reply || reply === 'NULL' || reply.toUpperCase() === 'NULL'
    if ((parsed.should_stop || noReply) && parsed.filled < 7) {
      console.log(`[AI] Model wants to stop but only ${parsed.filled}/7 filled — generating fallback for: ${parsed.next_missing}`)
      let fallback = _buildFallbackMessage(parsed.next_missing, parsed.analysis, history)
      if (fallback) {
        // Check this fallback isn't a duplicate of a message we already sent
        const fbLower = fallback.toLowerCase().trim()
        const isDupe = ourMessages.some(m => m.body?.toLowerCase().trim() === fbLower)
        if (!isDupe) return fallback
        // Try another field if this one's a dupe
        const allFields = ['address', 'city', 'prices', 'nationality', 'incall_outcall', 'independent', 'photos', 'video']
        for (const f of allFields) {
          if (f === parsed.next_missing) continue
          fallback = _buildFallbackMessage(f, parsed.analysis, history)
          if (fallback && !ourMessages.some(m => m.body?.toLowerCase().trim() === fallback.toLowerCase().trim())) {
            return fallback
          }
        }
      }
      // All fallbacks exhausted — return null (but orchestrator won't mark as done)
      return null
    }

    // No reply at all and 7+ fields
    if (noReply) {
      console.log(`[AI] No reply provided — stopping`)
      return null
    }

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
      // Fuzzy match: if 85%+ of words overlap → same question rephrased
      const prevWords = new Set(prev.replace(/[?!.,]/g, '').split(/\s+/).filter(w => w.length > 3))
      const replyWordsLong = new Set(replyLower.replace(/[?!.,]/g, '').split(/\s+/).filter(w => w.length > 3))
      if (replyWordsLong.size >= 3 && prevWords.size >= 3) {
        const overlap = [...replyWordsLong].filter(w => prevWords.has(w)).length
        const similarity = overlap / Math.max(replyWordsLong.size, prevWords.size)
        if (similarity >= 0.85) {
          console.log(`[AI-Responder] Reply too similar to previous (${(similarity * 100).toFixed(0)}%): "${prev.substring(0, 40)}" vs "${replyLower.substring(0, 40)}"`)
          // Instead of returning null, try fallback
          const fallback = _buildFallbackMessage(null, null, history)
          if (fallback) return fallback
          return null
        }
      }
    }

    // Clean up
    let cleaned = reply.replace(/^["']|["']$/g, '').trim()
    if (cleaned.length > 200) cleaned = cleaned.substring(0, 200)

    // Run safety filters (banned words)
    cleaned = _sanitizeReply(cleaned, false)
    if (!cleaned) {
      console.log(`[AI] Reply blocked by safety filter — skipping`)
      return null
    }

    return cleaned
  } catch (err) {
    console.error('[AI-Responder] Error:', err.message)
    // 429 = quota exceeded — throw so orchestrator knows NOT to mark as done
    if (err.status === 429 || err.message?.includes('429')) {
      throw err
    }
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
        content: `Extract structured data from this conversation for a directory profile.

CONVERSATION:
${transcript}

Extract these fields (null if not mentioned):
- address: EXACT address (street + number + city) (string or null)
- city: city name (string or null)
- price_text: full price list as stated e.g. "30min: 500, 1h: 800" (string or null)
- price_min: minimum price in ILS (number or null)
- price_max: maximum price in ILS (number or null)
- nationality: nationality/ethnicity (string or null)
- incall_outcall: "incall" / "outcall" / "both" (string or null)
- independent_or_agency: "independent" / "agency" (string or null)
- has_photos: did she send photos (true/false)
- photos_count: how many photos sent (number)
- has_video: did she send video (true/false)
- age: her age (number or null)
- services: array of services (array or null)
- availability: working hours (string or null)
- languages: languages spoken (array or null)
- language: conversation language ("hebrew"/"russian"/"english"/"other")
- sentiment: her attitude ("positive"/"neutral"/"negative"/"unresponsive")
- completeness: "HOT" if 6+ of 7 essentials filled, "WARM" if 3-5, "COLD" if less

Respond with ONLY valid JSON.`,
      }],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      ...tokenLimitParam(EXTRACT_MODEL, 800),
    })

    return JSON.parse(response.choices[0].message.content)
  } catch (err) {
    console.error('[AI-Responder] Extraction error:', err.message)
    return null
  }
}

// ─── Score calculator (0-100) ──────────────────────────────────────────────────

/**
 * Calculate a numeric score 0-100 from extracted conversation data.
 * No API calls — pure calculation from already-extracted fields.
 *
 * Weights:
 *   address: 15, city: 10, prices: 15, nationality: 8,
 *   incall_outcall: 8, independent: 8, photos: 12,
 *   video: 5, age: 3, services: 3, availability: 3,
 *   sentiment: 5, multiple_prices: 5
 */
export function calculateScore(data) {
  if (!data || typeof data !== 'object') return 0
  let score = 0

  const filled = (v) => v && v !== 'null' && v !== null && v !== 'N/A' && v !== 'unknown'

  // 7 essential fields (76 points total)
  if (filled(data.address) || filled(data.location)) score += 15
  if (filled(data.city)) score += 10
  if (filled(data.price_text) || filled(data.price) || filled(data.price_min)) score += 15
  if (filled(data.nationality)) score += 8
  if (filled(data.incall_outcall)) score += 8
  if (filled(data.independent_or_agency) || filled(data.independent)) score += 8
  if (data.has_photos === true || (data.photos_count && data.photos_count > 0)) score += 12

  // Bonus fields (24 points total)
  if (data.has_video === true) score += 5
  if (filled(data.age)) score += 3
  if (Array.isArray(data.services) && data.services.length > 0) score += 3
  if (filled(data.availability)) score += 3
  if (data.sentiment === 'positive') score += 5

  // Multiple prices bonus (has comma, semicolon, or multiple numbers)
  const priceStr = String(data.price_text || data.price || '')
  if (priceStr && (priceStr.includes(',') || priceStr.includes(';') || priceStr.includes('\n') || (priceStr.match(/\d+/g) || []).length >= 2)) {
    score += 5
  }

  return Math.min(score, 100)
}

/**
 * Get score category from numeric score.
 */
export function scoreCategory(num) {
  if (num >= 80) return 'hot'
  if (num >= 50) return 'warm'
  if (num >= 20) return 'cold'
  return 'irrelevant'
}
