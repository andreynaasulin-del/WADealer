// ─── Shared bot auth state store ─────────────────────────────────────────────
// Separate module to avoid circular imports between auth.js and wadealer-bot.js

class TTLMap {
  constructor(maxAge = 5 * 60 * 1000) {
    this._map = new Map()
    this._maxAge = maxAge
    this._sweepTimer = setInterval(() => this._sweep(), 60 * 1000)
    this._sweepTimer.unref()
  }
  set(key, value) { this._map.set(key, { value, ts: Date.now() }) }
  get(key) {
    const entry = this._map.get(key)
    if (!entry) return undefined
    if (Date.now() - entry.ts > this._maxAge) { this._map.delete(key); return undefined }
    return entry.value
  }
  _sweep() {
    const now = Date.now()
    for (const [key, entry] of this._map) {
      if (now - entry.ts > this._maxAge) this._map.delete(key)
    }
  }
}

const botAuthStates = new TTLMap(5 * 60 * 1000)

export function setBotAuthState(state, data) { botAuthStates.set(state, data) }
export function getBotAuthState(state) { return botAuthStates.get(state) }
