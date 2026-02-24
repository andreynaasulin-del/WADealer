import { TelegramClient, Api } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
import { computeCheck } from 'telegram/Password.js'
import { EventEmitter } from 'events'

const apiId = parseInt(process.env.TG_API_ID || '0')
const apiHash = process.env.TG_API_HASH || ''

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
    this.client = new TelegramClient(session, apiId, apiHash, {
      connectionRetries: 5,
    })
    await this.client.connect()

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
        { apiId, apiHash },
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
