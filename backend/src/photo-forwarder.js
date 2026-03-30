/**
 * Photo Forwarder — monitors Tahles bot for incoming photos
 * and forwards them to admin with sender info.
 *
 * Run standalone: node src/photo-forwarder.js
 * Or import and call startPhotoForwarder(botToken, adminChatId)
 */

const BOT_TOKEN = process.env.TAHLES_BOT_TOKEN || '8628616397:AAEBor4NEpBBMgRDSVG8nyioFZF4qz2wFJo'
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '7984904430'
const STAGING_GROUP_ID = process.env.STAGING_GROUP_ID || '-1003838859118'
const POLL_INTERVAL = 3000 // 3 seconds

let lastUpdateId = 0
let running = false

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, opts)
  return res.json()
}

async function getUpdates() {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=30&allowed_updates=["message"]`
  try {
    const data = await fetchJSON(url)
    if (data.ok) return data.result
    return []
  } catch (err) {
    console.error('[Forwarder] getUpdates error:', err.message)
    return []
  }
}

async function sendMessage(chatId, text, opts = {}) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`
  return fetchJSON(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', ...opts }),
  })
}

async function forwardMessage(fromChatId, messageId, toChatId) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/forwardMessage`
  return fetchJSON(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: toChatId, from_chat_id: fromChatId, message_id: messageId }),
  })
}

async function processUpdate(update) {
  lastUpdateId = update.update_id
  const msg = update.message
  if (!msg) return

  const from = msg.from || {}
  const chatId = msg.chat.id
  const fromName = [from.first_name, from.last_name].filter(Boolean).join(' ')
  const fromUser = from.username ? `@${from.username}` : fromName
  const isPrivate = msg.chat.type === 'private'

  // Only process private messages (DMs to the bot)
  if (!isPrivate) return

  const hasPhoto = !!msg.photo
  const hasVideo = !!msg.video
  const hasDocument = !!msg.document
  const hasMedia = hasPhoto || hasVideo || hasDocument
  const text = msg.text || msg.caption || ''

  if (hasMedia) {
    // Forward the media message to admin
    const header = `📸 <b>Новое фото верификации!</b>\n\n` +
      `👤 От: <b>${fromName}</b> (${fromUser})\n` +
      `🆔 TG ID: <code>${from.id}</code>\n` +
      `💬 Подпись: ${text || '—'}`

    // Send header to admin
    await sendMessage(ADMIN_CHAT_ID, header)

    // Forward original message to admin
    await forwardMessage(chatId, msg.message_id, ADMIN_CHAT_ID)

    // Also forward to staging group if configured
    if (STAGING_GROUP_ID) {
      await sendMessage(STAGING_GROUP_ID, header).catch(() => {})
      await forwardMessage(chatId, msg.message_id, STAGING_GROUP_ID).catch(() => {})
    }

    // Reply to user
    await sendMessage(chatId, 'תודה! 🙏\nהתמונה התקבלה ונבדקת. נעדכן אותך בהקדם ✅')

    console.log(`[Forwarder] Photo from ${fromUser} (${from.id}) forwarded to admin`)
  } else if (text) {
    // Text message — forward to admin too
    const header = `💬 <b>הודעה חדשה</b>\n\n` +
      `👤 ${fromName} (${fromUser})\n` +
      `🆔 <code>${from.id}</code>\n\n` +
      `${text}`

    await sendMessage(ADMIN_CHAT_ID, header)
    console.log(`[Forwarder] Text from ${fromUser}: ${text.slice(0, 50)}`)
  }
}

async function pollLoop() {
  console.log(`[Forwarder] Started — forwarding to admin ${ADMIN_CHAT_ID}`)
  running = true

  while (running) {
    try {
      const updates = await getUpdates()
      for (const update of updates) {
        await processUpdate(update)
      }
    } catch (err) {
      console.error('[Forwarder] Poll error:', err.message)
      await new Promise(r => setTimeout(r, 5000))
    }
  }
}

export function startPhotoForwarder() {
  pollLoop()
}

export function stopPhotoForwarder() {
  running = false
}

// Run standalone
import { fileURLToPath } from 'url'
const __filename = fileURLToPath(import.meta.url)
if (process.argv[1] === __filename) {
  console.log('[Forwarder] Running standalone')
  pollLoop()
}
