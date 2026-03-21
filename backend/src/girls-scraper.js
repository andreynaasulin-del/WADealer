/**
 * Girls Scraper — find working girls in TG groups by analyzing profiles.
 *
 * Checks: bio text, first/last name, username, profile photo presence.
 * Identifies "working" profiles by keywords, emojis, and patterns.
 * Saves to tg_girls table for mass DM campaign.
 */
import { Api } from 'telegram'

// ─── Working girl detection signals ──────────────────────────────────────────

// Bio keywords that indicate working girl (Hebrew, Russian, English, Arabic)
const BIO_KEYWORDS = [
  // Hebrew
  'מסאז', 'עיסוי', 'ליווי', 'פגישות', 'דיסקרטי', 'שירותי', 'זמינה', 'מארחת',
  'פרטי', 'הנאה', 'פינוק', 'חוויה', 'לילה', 'אירוח', 'נערת', 'מלווה',
  'outcall', 'incall', 'available', 'hosting',
  // Russian
  'массаж', 'эскорт', 'встречи', 'сопровожд', 'досуг', 'интим', 'услуг',
  'приму', 'приеду', 'индивидуал', 'час', 'ночь', 'апартамент',
  'relax', 'расслаб', 'девушка', 'красотка',
  // English
  'massage', 'escort', 'companion', 'model', 'exclusive', 'premium',
  'private', 'vip', 'booking', 'appointment', 'service', 'gfe',
  'independent', 'date', 'meet', 'avail',
  // Price-related
  '₪', 'שח', '$', '€', 'price', 'מחיר', 'цена', 'тариф', 'rate',
]

// Name/username patterns for working profiles
const NAME_SIGNALS = [
  '💋', '🔥', '💗', '🫦', '💦', '🍑', '👄', '💕', '❤️‍🔥', '🥵', '💎', '👸',
  '🌹', '💜', '🖤', '💞', '✨', '🦋', '🌸', '💫', '😈', '🍒', '💄',
  'vip', 'escort', 'model', 'massage', 'מסאז', 'ליווי',
  'hot', 'sexy', 'babe', 'beauty', 'angel', 'queen', 'goddess', 'doll',
  'premium', 'exclusive', 'private', 'available', 'new girl',
]

// Trans indicators to EXCLUDE
const TRANS_SIGNALS = [
  'trans', 'טרנס', 'транс', 'shemale', 'ts ', 'tgirl', 'ladyboy',
  'трансвестит', 'трансгендер',
]

// Known female name patterns (broader than the invite scraper)
const FEMALE_INDICATORS = new Set([
  'noa', 'noy', 'maya', 'shira', 'yael', 'tamar', 'michal', 'dana', 'mor',
  'chen', 'talia', 'lee', 'tal', 'sapir', 'keren', 'liat', 'shani', 'hila',
  'gal', 'roni', 'hadas', 'inbar', 'efrat', 'meital', 'orly', 'orna',
  'anna', 'maria', 'elena', 'olga', 'natasha', 'natalia', 'ekaterina',
  'irina', 'tatiana', 'svetlana', 'marina', 'julia', 'yulia', 'oksana',
  'vera', 'galina', 'daria', 'kristina', 'polina', 'anastasia', 'alexandra',
  'victoria', 'alina', 'diana', 'sofia', 'karina', 'yana', 'lena', 'masha',
  'jessica', 'jennifer', 'ashley', 'amanda', 'stephanie', 'nicole',
  'melissa', 'michelle', 'elizabeth', 'samantha', 'sarah', 'emily',
  'rebecca', 'lisa', 'laura', 'kate', 'mary', 'patricia', 'linda',
  'fatima', 'aisha', 'layla', 'noor', 'hana', 'reem', 'dina', 'lina',
  'natali', 'megan', 'alice', 'eva', 'emma', 'lily', 'ella', 'mia',
  'coral', 'koral', 'bella', 'dolce', 'candy', 'honey', 'angel',
  'sugar', 'cherry', 'diamond', 'crystal', 'amber', 'ruby', 'jade',
  'rose', 'violet', 'iris', 'jasmine', 'chloe', 'sophie', 'olivia',
  'agam', 'neta', 'lihi', 'hadar', 'alma', 'noga', 'stav',
])

// Male indicators to EXCLUDE
const MALE_INDICATORS = new Set([
  'david', 'moshe', 'yosef', 'daniel', 'michael', 'avi', 'amit', 'amir',
  'eyal', 'oren', 'guy', 'noam', 'omer', 'yonatan', 'alexander', 'alexei',
  'andrei', 'anton', 'boris', 'denis', 'dmitri', 'igor', 'ilya', 'ivan',
  'james', 'john', 'robert', 'william', 'richard', 'joseph', 'thomas',
  'ahmed', 'mohammed', 'ali', 'omar', 'hassan', 'hussein', 'khalid',
])

/**
 * Analyze a user profile and determine if it's a "working girl".
 * Returns { isTarget, score, signals[] }
 */
function analyzeProfile(user, bio = '') {
  const signals = []
  let score = 0

  const firstName = (user.firstName || '').toLowerCase().trim()
  const lastName = (user.lastName || '').toLowerCase().trim()
  const username = (user.username || '').toLowerCase().trim()
  const fullName = `${firstName} ${lastName}`.trim()
  const bioLower = (bio || '').toLowerCase()
  const allText = `${fullName} ${username} ${bioLower}`

  // ── Exclude: bots ──
  if (user.bot) return { isTarget: false, score: 0, signals: ['bot'] }

  // ── Exclude: trans (except KORAL) ──
  if (username !== 'koral') {
    for (const t of TRANS_SIGNALS) {
      if (allText.includes(t)) {
        return { isTarget: false, score: 0, signals: ['trans'] }
      }
    }
  }

  // ── Exclude: obvious males ──
  const nameClean = firstName.replace(/[^a-z\u0400-\u04ff\u0590-\u05ff]/g, '')
  if (MALE_INDICATORS.has(nameClean) && !bio) {
    return { isTarget: false, score: 0, signals: ['male_name'] }
  }

  // ── Signal: female name ──
  if (FEMALE_INDICATORS.has(nameClean)) {
    score += 2
    signals.push('female_name')
  }

  // ── Signal: bio keywords ──
  if (bio) {
    for (const kw of BIO_KEYWORDS) {
      if (bioLower.includes(kw.toLowerCase())) {
        score += 3
        signals.push(`bio:${kw}`)
        break // one bio match is enough for score
      }
    }
    // Any bio at all is a mild signal (working girls tend to have bios)
    if (bio.length > 10) {
      score += 1
      signals.push('has_bio')
    }
  }

  // ── Signal: provocative name/username emojis and words ──
  for (const sig of NAME_SIGNALS) {
    if (allText.includes(sig.toLowerCase())) {
      score += 2
      signals.push(`name:${sig}`)
      break // one match enough
    }
  }

  // ── Signal: has profile photo ──
  if (user.photo) {
    score += 1
    signals.push('has_photo')
  }

  // ── Signal: name ends in female suffix ──
  if (nameClean.length > 2) {
    if (nameClean.endsWith('a') || nameClean.endsWith('ya') || nameClean.endsWith('la') ||
        nameClean.endsWith('na') || nameClean.endsWith('ka')) {
      score += 1
      signals.push('female_suffix')
    }
  }

  // ── Signal: phone number in bio (advertisers often put it) ──
  if (/\+?\d[\d\s-]{8,}/.test(bio)) {
    score += 2
    signals.push('phone_in_bio')
  }

  // ── Signal: link in bio (website, telegram, etc) ──
  if (/https?:\/\/|t\.me\/|@\w/.test(bio)) {
    score += 1
    signals.push('link_in_bio')
  }

  // Threshold: score >= 3 means likely working girl
  const isTarget = score >= 3

  return { isTarget, score, signals }
}

/**
 * Scrape working girls from a group.
 * For each participant, fetches their full profile (bio) via GetFullUser.
 *
 * @param {TelegramSession} session - active TG session
 * @param {string} entity - group username or link
 * @param {function} onGirl - callback({ userId, username, firstName, lastName, bio, score, signals })
 * @returns {{ total, found, skipped }}
 */
export async function scrapeWorkingGirls(session, entity, onGirl) {
  if (session.status !== 'active' || !session.client) {
    throw new Error('Аккаунт не активен')
  }

  let total = 0
  let found = 0
  let skipped = 0
  const seen = new Set()

  session.log(`Начинаем скрейп девушек из ${entity}`)

  try {
    for await (const participant of session.client.iterParticipants(entity, { limit: 200 })) {
      total++

      // Skip bots
      if (participant.bot) { skipped++; continue }

      // Deduplicate
      const uid = typeof participant.id === 'bigint' ? Number(participant.id) : participant.id
      if (seen.has(uid)) { continue }
      seen.add(uid)

      // Quick pre-filter: skip obvious males without photo
      const nameClean = (participant.firstName || '').toLowerCase().replace(/[^a-z\u0400-\u04ff\u0590-\u05ff]/g, '')
      if (MALE_INDICATORS.has(nameClean) && !participant.photo) {
        skipped++
        continue
      }

      // Fetch full user profile (bio) — with rate limiting
      let bio = ''
      try {
        const fullUser = await session.client.invoke(new Api.users.GetFullUser({
          id: new Api.InputUser({
            userId: participant.id,
            accessHash: participant.accessHash || BigInt(0),
          })
        }))
        bio = fullUser?.fullUser?.about || ''
      } catch (err) {
        if (err.errorMessage?.startsWith('FLOOD_WAIT')) {
          const wait = parseInt(err.errorMessage.split('_').pop()) || err.seconds || 30
          session.log(`FloodWait ${wait}с при GetFullUser — ждём...`, 'warn')
          await new Promise(r => setTimeout(r, wait * 1000))
        }
        // Continue even if GetFullUser fails
      }

      // Small delay between GetFullUser calls to avoid flood
      await new Promise(r => setTimeout(r, 300 + Math.random() * 500))

      // Analyze profile
      const analysis = analyzeProfile(participant, bio)

      if (analysis.isTarget) {
        found++
        const girl = {
          userId: uid,
          accessHash: participant.accessHash ? String(participant.accessHash) : null,
          username: participant.username || null,
          firstName: participant.firstName || null,
          lastName: participant.lastName || null,
          bio,
          score: analysis.score,
          signals: analysis.signals,
        }
        await onGirl(girl)
        session.log(`✅ [${found}] @${girl.username || uid} | ${girl.firstName} | score=${analysis.score} | ${analysis.signals.join(',')}`)
      } else {
        skipped++
      }
    }
  } catch (err) {
    if (err.errorMessage?.startsWith('FLOOD_WAIT')) {
      const seconds = parseInt(err.errorMessage.split('_').pop()) || err.seconds || 60
      session.log(`FloodWait ${seconds}с — ждём...`, 'warn')
      await new Promise(r => setTimeout(r, seconds * 1000))
    } else {
      throw err
    }
  }

  session.log(`Скрейп девушек завершён: ${found} найдено из ${total} (пропущено ${skipped})`)
  return { total, found, skipped }
}

export { analyzeProfile }
