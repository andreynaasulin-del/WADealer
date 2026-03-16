import { TelegramClient, Api } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
import { computeCheck } from 'telegram/Password.js'
import { EventEmitter } from 'events'

// Lazy-read env vars (ESM hoists imports before dotenv/config runs)
function getApiId() { return parseInt(process.env.TG_API_ID || '0') }
function getApiHash() { return process.env.TG_API_HASH || '' }

// ─── Gender detection by first name ─────────────────────────────────────────
// Hebrew/Russian/English female name patterns — used to EXCLUDE women
const FEMALE_NAMES = new Set([
  // Hebrew female
  'noa','noy','maya','shira','yael','tamar','michal','dana','mor','chen','talia','lee','tal','rotem','sapir',
  'keren','liat','shani','hila','gal','roni','hadas','inbar','efrat','meital','orly','orna','revital','galit',
  'sigal','osnat','orit','anat','ilanit','limor','nurit','ruth','miriam','sara','sarah','avital','liora',
  'ayelet','neta','adi','maayan','naama','lihi','amit','eden','agam','hadar','alma','daniela','yonat',
  'reut','sivan','einav','lilac','lior','shirel','nofar','tehila','hodaya','bat','shaked','coral',
  'noga','ori','hagar','yasmin','karen','stav','tali','lia','lian','ella','emma','mia','lily','anna',
  'rona','dikla','shirly','aya','nirit','shlomit','malka','rachel','leah','rivka',
  // Russian female
  'anna','maria','elena','olga','natasha','natalia','ekaterina','irina','tatiana','svetlana','marina',
  'julia','yulia','oksana','vera','galina','lyudmila','valentina','tamara','larisa','nina','alla',
  'daria','kristina','polina','anastasia','alexandra','victoria','alina','diana','sofia','karina',
  'yana','lena','masha','dasha','sasha','katya','nastya','sveta','tanya','liza','ira','nadya',
  'zhenya','valeria','veronika','eva','milana','arina','alisa','mila','zlata',
  // English/common female
  'jessica','jennifer','ashley','amanda','stephanie','nicole','melissa','michelle','elizabeth','samantha',
  'sarah','emily','rebecca','lisa','laura','heather','angela','amber','rachel','christina','lauren','brittany',
  'kate','mary','patricia','linda','barbara','margaret','susan','dorothy','karen','nancy','betty','helen',
  'donna','carol','ruth','sharon','cynthia','kathleen','amy','deborah','shirley','brenda',
  // Arabic female
  'fatima','aisha','layla','noor','hana','reem','dina','lina','rana','amira','yasmine','salma','mariam',
])

const MALE_NAMES = new Set([
  // Hebrew male
  'david','moshe','yosef','avraham','yaakov','yitzhak','daniel','michael','avi','amit','amir','idan',
  'eyal','oren','ran','tal','rotem','gal','lior','chen','guy','noam','omer','itai','yonatan','elad',
  'oded','shachar','roi','matan','asaf','barak','gilad','nadav','eran','nir','shai','alon','yaron',
  'ronen','arie','ori','dor','tomer','ben','yossi','rami','haim','shimon','shlomo','ehud',
  'gadi','boaz','amnon','kobi','erez','meir','ariel','uri','tzvi','doron','yehuda','baruch',
  'avi','dima','benny','ilan','ofir','eliran','moti','zvika',
  // Russian male
  'alexander','alexei','andrei','anton','artem','boris','denis','dmitri','dmitry','evgeni','evgeny',
  'igor','ilya','ivan','kirill','konstantin','leonid','maxim','mikhail','nikita','nikolai',
  'oleg','pavel','roman','ruslan','sergei','sergey','stanislav','vadim','valery','vasily',
  'victor','viktor','vitaly','vladimir','vlad','yuri','yury','grigory','arkady','timur',
  'kolya','petya','sasha','dima','vanya','misha','pasha','zhenya','kostya','slava','tolya',
  // English/common male
  'james','john','robert','michael','william','david','richard','joseph','thomas','charles','daniel',
  'matthew','anthony','mark','donald','steven','paul','andrew','joshua','kenneth','kevin','brian',
  'george','timothy','ronald','edward','jason','jeffrey','ryan','jacob','gary','nicholas','eric',
  'stephen','jonathan','larry','justin','scott','brandon','benjamin','samuel','raymond','gregory',
  'frank','alexander','patrick','jack','dennis','jerry','tyler','aaron','jose','adam','nathan',
  // Arabic male
  'ahmed','mohammed','ali','omar','hassan','hussein','khalid','samir','fadi','rami','nabil','tariq',
  'karim','walid','ayman','bilal','youssef','ibrahim','mustafa','jamal',
])

/**
 * Guess gender from first name.
 * Returns 'male', 'female', or 'unknown'.
 */
function guessGender(firstName) {
  if (!firstName) return 'unknown'
  const name = firstName.toLowerCase().trim().replace(/[^a-z\u0400-\u04ff\u0590-\u05ff]/g, '')
  if (!name) return 'unknown'

  // Direct set lookup
  if (FEMALE_NAMES.has(name)) return 'female'
  if (MALE_NAMES.has(name)) return 'male'

  // Hebrew unicode name heuristics
  // Names ending with common Hebrew female suffixes
  if (/[aeiou]$/.test(name) && name.length > 2) {
    // Common female endings in transliterated Hebrew: -a, -i, -it, -li, -ela
    if (name.endsWith('it') || name.endsWith('ela') || name.endsWith('lia')) return 'female'
  }

  return 'unknown'
}

/**
 * TelegramSession — manages a single Telegram USER ACCOUNT via MTProto (GramJS).
 * Analogous to Session (WhatsApp/Baileys) but for Telegram user login.
 *
 * Auth flow: phone → code → (optional 2FA password) → session active.
 * Session string is persisted to DB for auto-reconnection.
 */
export class TelegramSession extends EventEmitter {
  constructor(id, phone, orchestrator, sessionString = '') {
    super()
    this.id = id               // UUID from Supabase
    this.phone = phone
    this.orchestrator = orchestrator
    this.sessionString = sessionString
    this.client = null
    this.phoneCodeHash = null
    this.status = 'disconnected'  // disconnected | awaiting_code | awaiting_password | active | error
    this.username = null
    this.firstName = null
    this.lastName = null
    this.connectedAt = null
  }

  log(message, level = 'info') {
    const label = this.username ? `@${this.username}` : this.phone
    this.orchestrator.log(label, message, level, 'telegram')
  }

  /**
   * Connect to Telegram. If we have a saved session string, auto-authenticate.
   * Otherwise, just establish the connection (ready for requestCode).
   */
  async connect() {
    const session = new StringSession(this.sessionString)
    this.client = new TelegramClient(session, getApiId(), getApiHash(), {
      connectionRetries: 5,
      retryDelay: 2000,
    })
    try {
      await this.client.connect()
    } catch (err) {
      if (err.message?.includes('AUTH_KEY_DUPLICATED')) {
        this.log('AUTH_KEY_DUPLICATED — повторная попытка через 5с...', 'warn')
        await new Promise(r => setTimeout(r, 5000))
        // Recreate client and retry
        this.client = new TelegramClient(
          new StringSession(this.sessionString),
          getApiId(), getApiHash(),
          { connectionRetries: 5, retryDelay: 2000 }
        )
        await this.client.connect()
      } else {
        throw err
      }
    }

    // If we have a saved session, try to restore auth
    if (this.sessionString) {
      try {
        const me = await this.client.getMe()
        this.username = me.username || null
        this.firstName = me.firstName || null
        this.lastName = me.lastName || null
        this.status = 'active'
        this.connectedAt = new Date().toISOString()
        this.log('Аккаунт переподключён ✓')

        await this.orchestrator.db.dbUpdateTelegramAccountStatus(this.id, 'active')
        this.orchestrator.broadcast({
          type: 'tg_account_update',
          accountId: this.id,
          status: 'active',
          username: this.username,
          first_name: this.firstName,
        })
        return { status: 'active' }
      } catch (err) {
        // Session expired — need to re-auth
        this.sessionString = ''
        this.status = 'error'
        const msg = err.message || 'Session expired'
        this.log(`Сессия истекла: ${msg}`, 'error')
        await this.orchestrator.db.dbUpdateTelegramAccountStatus(this.id, 'error', msg)
        this.orchestrator.broadcast({
          type: 'tg_account_update',
          accountId: this.id,
          status: 'error',
          error_msg: msg,
        })
        return { status: 'error', error: msg }
      }
    }

    return { status: 'connected' }
  }

  /**
   * Request a verification code to the phone number.
   */
  async requestCode() {
    if (!this.client?.connected) {
      await this.connect()
    }

    try {
      const result = await this.client.sendCode(
        { apiId: getApiId(), apiHash: getApiHash() },
        this.phone
      )
      this.phoneCodeHash = result.phoneCodeHash
      this.status = 'awaiting_code'
      this.log('Код отправлен на телефон')

      await this.orchestrator.db.dbUpdateTelegramAccountStatus(this.id, 'awaiting_code')
      this.orchestrator.broadcast({
        type: 'tg_account_update',
        accountId: this.id,
        status: 'awaiting_code',
      })

      return { status: 'awaiting_code' }
    } catch (err) {
      this.status = 'error'
      const msg = err.errorMessage || err.message || 'Failed to send code'
      this.log(`Ошибка отправки кода: ${msg}`, 'error')
      await this.orchestrator.db.dbUpdateTelegramAccountStatus(this.id, 'error', msg)
      this.orchestrator.broadcast({
        type: 'tg_account_update',
        accountId: this.id,
        status: 'error',
        error_msg: msg,
      })
      throw new Error(msg)
    }
  }

  /**
   * Verify the code received on the phone.
   * May return { status: 'awaiting_password' } if 2FA is enabled.
   */
  async verifyCode(code) {
    if (!this.phoneCodeHash) throw new Error('Сначала запросите код')

    try {
      await this.client.invoke(new Api.auth.SignIn({
        phoneNumber: this.phone,
        phoneCodeHash: this.phoneCodeHash,
        phoneCode: code,
      }))
      return this._finishAuth()
    } catch (err) {
      if (err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
        this.status = 'awaiting_password'
        this.log('Требуется 2FA пароль')
        await this.orchestrator.db.dbUpdateTelegramAccountStatus(this.id, 'awaiting_password')
        this.orchestrator.broadcast({
          type: 'tg_account_update',
          accountId: this.id,
          status: 'awaiting_password',
        })
        return { status: 'awaiting_password' }
      }

      this.status = 'error'
      const msg = err.errorMessage || err.message || 'Invalid code'
      this.log(`Ошибка верификации: ${msg}`, 'error')
      await this.orchestrator.db.dbUpdateTelegramAccountStatus(this.id, 'error', msg)
      throw new Error(msg)
    }
  }

  /**
   * Verify 2FA password (if SESSION_PASSWORD_NEEDED was received).
   */
  async verifyPassword(password) {
    try {
      const passwordData = await this.client.invoke(new Api.account.GetPassword())
      const passwordCheck = await computeCheck(passwordData, password)
      await this.client.invoke(new Api.auth.CheckPassword({ password: passwordCheck }))
      return this._finishAuth()
    } catch (err) {
      this.status = 'error'
      const msg = err.errorMessage || err.message || 'Invalid password'
      this.log(`Ошибка 2FA: ${msg}`, 'error')
      await this.orchestrator.db.dbUpdateTelegramAccountStatus(this.id, 'error', msg)
      throw new Error(msg)
    }
  }

  /**
   * Finish auth — save session string, update DB, broadcast.
   */
  async _finishAuth() {
    this.sessionString = this.client.session.save()
    const me = await this.client.getMe()
    this.username = me.username || null
    this.firstName = me.firstName || null
    this.lastName = me.lastName || null
    this.status = 'active'
    this.connectedAt = new Date().toISOString()

    this.log(`Аккаунт ${this.username ? '@' + this.username : this.phone} подключён ✓`)

    // Save session string + user info to DB
    await this.orchestrator.db.dbUpdateTelegramAccountStatus(this.id, 'active')
    await this.orchestrator.db.dbUpdateTelegramAccountInfo(
      this.id, this.username, this.firstName, this.lastName, this.sessionString
    )

    this.orchestrator.broadcast({
      type: 'tg_account_update',
      accountId: this.id,
      status: 'active',
      username: this.username,
      first_name: this.firstName,
    })

    return {
      status: 'active',
      username: this.username,
      firstName: this.firstName,
    }
  }

  /**
   * Send a text message to a user/chat/group.
   * @param {string} chatId — username or numeric chat ID
   * @param {string} text — message text
   */
  async sendMessage(chatId, text) {
    if (this.status !== 'active' || !this.client) {
      throw new Error('Аккаунт не активен')
    }

    // Numeric IDs → number, otherwise keep as string (username)
    let entity = chatId
    if (/^-?\d+$/.test(chatId)) {
      entity = parseInt(chatId)
    }

    await this.client.sendMessage(entity, { message: text })
    this.log(`Сообщение отправлено → ${chatId}`)
  }

  /**
   * Disconnect — keep session string for reconnection later.
   */
  async disconnect() {
    this.status = 'disconnected'
    try {
      if (this.client) {
        await this.client.disconnect()
        this.client = null
      }
    } catch (_) {}

    this.log('Аккаунт отключён')
    await this.orchestrator.db.dbUpdateTelegramAccountStatus(this.id, 'disconnected')
    this.orchestrator.broadcast({
      type: 'tg_account_update',
      accountId: this.id,
      status: 'disconnected',
    })
  }

  // ─── Group scraping & invite methods ──────────────────────────────────────

  /**
   * Join a Telegram group/channel by link.
   * Supports both public (t.me/username) and private (t.me/+HASH) links.
   * @returns {{ title: string, id: BigInt, participantsCount: number }}
   */
  async joinGroup(link) {
    if (this.status !== 'active' || !this.client) throw new Error('Аккаунт не активен')

    // Parse link type
    const inviteMatch = link.match(/t\.me\/\+([a-zA-Z0-9_-]+)/) || link.match(/t\.me\/joinchat\/([a-zA-Z0-9_-]+)/)
    const usernameMatch = !inviteMatch && link.match(/t\.me\/([a-zA-Z0-9_]+)/)

    let result
    try {
      if (inviteMatch) {
        const hash = inviteMatch[1]
        result = await this.client.invoke(new Api.messages.ImportChatInvite({ hash }))
      } else if (usernameMatch) {
        const username = usernameMatch[1]
        result = await this.client.invoke(new Api.channels.JoinChannel({
          channel: username,
        }))
      } else {
        throw new Error(`Невалидная ссылка: ${link}`)
      }
    } catch (err) {
      // Already a participant — not an error
      if (err.errorMessage === 'USER_ALREADY_PARTICIPANT' || err.errorMessage === 'INVITE_REQUEST_SENT') {
        this.log(`Уже в группе: ${link}`)
      } else if (err.errorMessage?.startsWith('FLOOD_WAIT') || err.errorMessage === 'FLOOD' || err.seconds) {
        const seconds = err.seconds || parseInt(err.errorMessage?.split('_').pop()) || 120
        this.log(`FloodWait ${seconds}с при вступлении в ${link}`, 'warn')
        if (seconds > 600) {
          // If flood wait is > 10 min, throw with special message so orchestrator can handle
          throw new Error(`FLOOD_LONG_${seconds}`)
        }
        await new Promise(r => setTimeout(r, (seconds + 5) * 1000))
        // Retry after waiting
        try {
          if (inviteMatch) {
            result = await this.client.invoke(new Api.messages.ImportChatInvite({ hash: inviteMatch[1] }))
          } else if (usernameMatch) {
            result = await this.client.invoke(new Api.channels.JoinChannel({ channel: usernameMatch[1] }))
          }
        } catch (retryErr) {
          if (retryErr.errorMessage === 'USER_ALREADY_PARTICIPANT') {
            this.log(`Уже в группе после retry: ${link}`)
          } else {
            throw retryErr
          }
        }
      } else {
        throw err
      }
    }

    // Resolve entity to get info
    try {
      const entity = usernameMatch
        ? await this.client.getEntity(usernameMatch[1])
        : await this.client.getEntity(result?.chats?.[0]?.id || link)
      return {
        title: entity.title || entity.username || '?',
        id: entity.id,
        participantsCount: entity.participantsCount || 0,
      }
    } catch {
      return { title: '?', id: null, participantsCount: 0 }
    }
  }

  /**
   * Scrape members from a group/channel.
   * Filters: skips bots and females (only keeps males + unknown gender).
   * @param {string|number} entity — group username or ID
   * @param {function} onBatch — callback(members[]) called for each batch of ~200
   * @returns {{ total: number, skippedFemale: number, skippedBot: number }}
   */
  async scrapeMembers(entity, onBatch) {
    if (this.status !== 'active' || !this.client) throw new Error('Аккаунт не активен')

    let total = 0
    let skippedFemale = 0
    let skippedBot = 0
    let batch = []
    const BATCH_SIZE = 200

    try {
      for await (const participant of this.client.iterParticipants(entity, { limit: BATCH_SIZE })) {
        // Skip bots
        if (participant.bot) {
          skippedBot++
          continue
        }

        // Gender filter — skip females
        const gender = guessGender(participant.firstName)
        if (gender === 'female') {
          skippedFemale++
          continue
        }

        batch.push({
          userId: typeof participant.id === 'bigint' ? Number(participant.id) : participant.id,
          accessHash: participant.accessHash ? String(participant.accessHash) : null,
          username: participant.username || null,
          firstName: participant.firstName || null,
          lastName: participant.lastName || null,
          phone: participant.phone || null,
          isBot: false,
          gender, // 'male' or 'unknown'
        })

        if (batch.length >= BATCH_SIZE) {
          await onBatch(batch)
          total += batch.length
          batch = []
        }
      }

      // Flush remaining
      if (batch.length > 0) {
        await onBatch(batch)
        total += batch.length
      }
    } catch (err) {
      if (err.errorMessage?.startsWith('FLOOD_WAIT')) {
        const seconds = parseInt(err.errorMessage.split('_').pop()) || err.seconds || 60
        this.log(`FloodWait ${seconds}с при скрейпе — ждём...`, 'warn')
        await new Promise(r => setTimeout(r, seconds * 1000))
        if (batch.length > 0) {
          await onBatch(batch)
          total += batch.length
        }
      } else {
        if (batch.length > 0) {
          await onBatch(batch)
          total += batch.length
        }
        throw err
      }
    }

    this.log(`Скрейп завершён: ${total} мужчин, пропущено ${skippedFemale} женщин, ${skippedBot} ботов`)
    return { total, skippedFemale, skippedBot }
  }

  /**
   * Invite a single user to a channel.
   * @param {string|number} channel — target channel username or ID
   * @param {{ userId: number, accessHash: string }} user
   * @returns {{ success: boolean, error?: string, rateLimited?: boolean }}
   */
  async inviteToChannel(channel, user) {
    if (this.status !== 'active' || !this.client) throw new Error('Аккаунт не активен')

    try {
      const channelEntity = await this.client.getEntity(channel)
      const inputUser = new Api.InputPeerUser({
        userId: user.userId,
        accessHash: BigInt(user.accessHash || '0'),
      })
      await this.client.invoke(new Api.channels.InviteToChannel({
        channel: channelEntity,
        users: [inputUser],
      }))
      return { success: true }
    } catch (err) {
      const msg = err.errorMessage || err.message || 'Unknown error'

      if (msg === 'USER_PRIVACY_RESTRICTED' || msg === 'USER_NOT_MUTUAL_CONTACT'
          || msg === 'USER_CHANNELS_TOO_MUCH' || msg === 'USER_KICKED') {
        return { success: false, error: msg }
      }
      if (msg === 'PEER_FLOOD' || msg === 'PeerFloodError') {
        this.log('PeerFlood — лимит инвайтов на сегодня!', 'error')
        return { success: false, error: 'PEER_FLOOD', rateLimited: true }
      }
      if (msg.startsWith('FLOOD_WAIT')) {
        const seconds = parseInt(msg.split('_').pop()) || err.seconds || 300
        this.log(`FloodWait ${seconds}с при инвайте`, 'warn')
        await new Promise(r => setTimeout(r, seconds * 1000))
        return this.inviteToChannel(channel, user) // retry
      }
      return { success: false, error: msg }
    }
  }

  /**
   * Get account state for API response.
   */
  getState() {
    return {
      id: this.id,
      phone: this.phone,
      username: this.username,
      first_name: this.firstName,
      last_name: this.lastName,
      status: this.status,
      connectedAt: this.connectedAt,
    }
  }
}
