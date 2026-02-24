'use client'
import { useState } from 'react'
import { api, type TelegramAccount, type TelegramCampaign } from '@/lib/api'

const STATUS_BORDER: Record<string, string> = {
  active:          'border-blue-500/40',
  disconnected:    'border-zinc-700',
  awaiting_code:   'border-yellow-600/40',
  awaiting_password: 'border-yellow-600/40',
  error:           'border-red-500/40',
}

const STATUS_BG: Record<string, string> = {
  active:          'bg-blue-950/20',
  disconnected:    'bg-zinc-900',
  awaiting_code:   'bg-yellow-950/15',
  awaiting_password: 'bg-yellow-950/15',
  error:           'bg-red-950/20',
}

const STATUS_DOT: Record<string, string> = {
  active:          'bg-blue-400',
  disconnected:    'bg-zinc-600',
  awaiting_code:   'bg-yellow-400 animate-pulse',
  awaiting_password: 'bg-yellow-400 animate-pulse',
  error:           'bg-red-500 animate-pulse',
}

const STATUS_LABELS: Record<string, string> = {
  active:          'Активен',
  disconnected:    'Отключён',
  awaiting_code:   'Ожидает код',
  awaiting_password: 'Ожидает пароль',
  error:           'Ошибка',
}

const STATUS_LABEL_COLOR: Record<string, string> = {
  active:          'text-blue-400',
  disconnected:    'text-zinc-500',
  awaiting_code:   'text-yellow-400',
  awaiting_password: 'text-yellow-400',
  error:           'text-red-400',
}

/** Format uptime from ISO connectedAt to human-readable string */
function formatUptime(connectedAt: string | null): string {
  if (!connectedAt) return '—'
  const diff = Date.now() - new Date(connectedAt).getTime()
  if (diff < 0) return '—'
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes}м`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours < 24) return `${hours}ч ${mins}м`
  const days = Math.floor(hours / 24)
  return `${days}д ${hours % 24}ч`
}

interface Props {
  accounts: TelegramAccount[]
  campaigns: TelegramCampaign[]
  onRefresh: () => void
  selectedAccountId: string | null
  onSelect: (id: string) => void
}

export default function TelegramAccountManager({ accounts, campaigns, onRefresh, selectedAccountId, onSelect }: Props) {
  const [phone, setPhone]                   = useState('')
  const [loading, setLoading]               = useState(false)
  const [error, setError]                   = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm]   = useState<string | null>(null)
  const [actionLoading, setActionLoading]   = useState<string | null>(null)

  // Per-account input states for code & password
  const [codeInputs, setCodeInputs]         = useState<Record<string, string>>({})
  const [passwordInputs, setPasswordInputs] = useState<Record<string, string>>({})

  async function addAccount() {
    if (!phone.trim()) return
    setLoading(true); setError(null)
    try {
      await api.telegram.accounts.create(phone.trim())
      setPhone('')
      onRefresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка добавления аккаунта')
    } finally {
      setLoading(false)
    }
  }

  async function requestCode(id: string) {
    setActionLoading(id); setError(null)
    try {
      await api.telegram.accounts.requestCode(id)
      onRefresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка запроса кода')
    } finally {
      setActionLoading(null)
    }
  }

  async function verifyCode(id: string) {
    const code = codeInputs[id]?.trim()
    if (!code) return
    setActionLoading(id); setError(null)
    try {
      await api.telegram.accounts.verifyCode(id, code)
      setCodeInputs(prev => ({ ...prev, [id]: '' }))
      onRefresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка подтверждения кода')
    } finally {
      setActionLoading(null)
    }
  }

  async function verifyPassword(id: string) {
    const password = passwordInputs[id]?.trim()
    if (!password) return
    setActionLoading(id); setError(null)
    try {
      await api.telegram.accounts.verifyPassword(id, password)
      setPasswordInputs(prev => ({ ...prev, [id]: '' }))
      onRefresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка подтверждения пароля')
    } finally {
      setActionLoading(null)
    }
  }

  async function connectAccount(id: string) {
    setActionLoading(id); setError(null)
    try {
      await api.telegram.accounts.connect(id)
      onRefresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка подключения')
    } finally {
      setActionLoading(null)
    }
  }

  async function disconnectAccount(id: string) {
    setActionLoading(id); setError(null)
    try {
      await api.telegram.accounts.disconnect(id)
      onRefresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка отключения')
    } finally {
      setActionLoading(null)
    }
  }

  async function removeAccount(id: string) {
    if (deleteConfirm !== id) {
      setDeleteConfirm(id)
      setTimeout(() => setDeleteConfirm(prev => prev === id ? null : prev), 3000)
      return
    }
    setDeleteConfirm(null); setError(null)
    try {
      await api.telegram.accounts.remove(id)
      onRefresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка удаления')
    }
  }

  /** Get per-account stats from campaigns */
  function getAccountStats(account: TelegramAccount) {
    const accCampaigns = campaigns.filter(c => c.account_id === account.id)
    const activeCampaigns = accCampaigns.filter(c => c.status === 'running').length
    const totalSent = accCampaigns.reduce((sum, c) => sum + c.total_sent, 0)
    const totalErrors = accCampaigns.reduce((sum, c) => sum + c.total_errors, 0)
    return { count: accCampaigns.length, active: activeCampaigns, sent: totalSent, errors: totalErrors }
  }

  const activeCount = accounts.filter(a => a.status === 'active').length

  return (
    <section className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-blue-400 font-bold tracking-widest uppercase text-xs">▸ Менеджер аккаунтов</span>
        <div className="flex items-center gap-2">
          {accounts.length > 0 && (
            <span className="text-blue-400 text-[10px] font-bold bg-blue-950/30 border border-blue-800/40 rounded px-1.5 py-0.5">
              {activeCount}/{accounts.length} активных
            </span>
          )}
        </div>
      </div>

      {/* Add account — phone number */}
      <div className="flex gap-2">
        <input
          className="flex-1 min-w-0 bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-200
                     placeholder-zinc-600 focus:outline-none focus:border-blue-500 transition-colors"
          placeholder="Номер телефона (+7...)"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && phone && !loading && addAccount()}
        />
        <button
          onClick={addAccount}
          disabled={loading || !phone}
          className="bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600
                     text-white font-bold text-xs rounded px-3 py-1.5 transition-colors cursor-pointer
                     disabled:cursor-not-allowed whitespace-nowrap"
        >
          {loading ? '...' : '+ Добавить'}
        </button>
      </div>

      {error && (
        <p className="text-red-400 text-xs bg-red-950/20 border border-red-900/50 rounded px-2 py-1.5">
          {error}
        </p>
      )}

      {/* Account list */}
      <div className="flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: 'calc(100% - 100px)' }}>
        {accounts.length === 0 && (
          <p className="text-zinc-700 text-xs text-center py-6">
            Добавьте Telegram-аккаунт по номеру телефона. Потребуется подтверждение кодом.
          </p>
        )}
        {accounts.map((a, index) => {
          const isSelected = selectedAccountId === a.id
          const st = getAccountStats(a)
          const isLoading = actionLoading === a.id
          return (
            <div
              key={a.id}
              onClick={() => onSelect(a.id)}
              className={`rounded-lg border px-3 py-2.5 transition-all cursor-pointer ${
                isSelected
                  ? 'border-blue-400/60 bg-blue-950/15 ring-1 ring-blue-400/20'
                  : `${STATUS_BORDER[a.status] || 'border-zinc-700'} ${STATUS_BG[a.status] || 'bg-zinc-900'} hover:border-zinc-600`
              }`}
            >
              {/* Top row: number + status dot + phone/username + delete */}
              <div className="flex items-center gap-2">
                {/* Account number */}
                <span className={`text-[10px] font-bold rounded w-5 h-5 flex items-center justify-center shrink-0 ${
                  a.status === 'active'
                    ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                    : a.status === 'error'
                      ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                      : a.status === 'awaiting_code' || a.status === 'awaiting_password'
                        ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                        : 'bg-zinc-800 text-zinc-500 border border-zinc-700'
                }`}>
                  {index + 1}
                </span>

                {/* Status dot */}
                <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[a.status] || 'bg-zinc-600'}`} />

                {/* Phone / username */}
                <span className="text-xs text-zinc-200 font-bold flex-1 min-w-0 truncate">
                  {a.username ? `@${a.username}` : a.phone}
                </span>

                {/* Name badge */}
                {a.first_name && (
                  <span className="text-[10px] text-zinc-600 bg-zinc-800/80 rounded px-1.5 py-0.5 shrink-0 truncate max-w-[100px]">
                    {a.first_name}{a.last_name ? ` ${a.last_name}` : ''}
                  </span>
                )}

                {/* Uptime (if active) */}
                {a.status === 'active' && a.connectedAt && (
                  <span className="text-[10px] text-zinc-600 shrink-0">
                    {formatUptime(a.connectedAt)}
                  </span>
                )}

                {/* Delete */}
                <button
                  onClick={(e) => { e.stopPropagation(); removeAccount(a.id) }}
                  className={`text-[10px] border rounded px-1.5 py-0.5 transition-colors cursor-pointer shrink-0 ${
                    deleteConfirm === a.id
                      ? 'text-red-400 border-red-600 bg-red-950/40 font-bold'
                      : 'text-zinc-700 border-zinc-800 hover:text-red-400 hover:border-red-800/50'
                  }`}
                >
                  {deleteConfirm === a.id ? 'точно?' : '✕'}
                </button>
              </div>

              {/* Middle row: status + action buttons */}
              <div className="flex items-center gap-2 mt-1.5 pl-7">
                <span className={`text-[10px] font-bold uppercase tracking-wider ${STATUS_LABEL_COLOR[a.status] || 'text-zinc-500'}`}>
                  {STATUS_LABELS[a.status]}
                </span>

                {/* Error message */}
                {a.status === 'error' && a.error_msg && (
                  <span className="text-[10px] text-red-400/70 truncate max-w-[150px]">
                    {a.error_msg}
                  </span>
                )}

                <div className="flex-1" />

                {/* Status-specific actions */}
                {a.status === 'disconnected' && (
                  <button
                    onClick={(e) => { e.stopPropagation(); requestCode(a.id) }}
                    disabled={isLoading}
                    className="text-yellow-400 text-[10px] border border-yellow-700/50 bg-yellow-950/30 rounded px-3 py-1
                               hover:bg-yellow-900/40 transition-colors cursor-pointer disabled:opacity-50
                               disabled:cursor-not-allowed font-bold"
                  >
                    {isLoading ? '...' : '📱 Запросить код'}
                  </button>
                )}

                {a.status === 'error' && (
                  <button
                    onClick={(e) => { e.stopPropagation(); requestCode(a.id) }}
                    disabled={isLoading}
                    className="text-yellow-400 text-[10px] border border-yellow-700/50 bg-yellow-950/30 rounded px-3 py-1
                               hover:bg-yellow-900/40 transition-colors cursor-pointer disabled:opacity-50
                               disabled:cursor-not-allowed font-bold"
                  >
                    {isLoading ? '...' : '↻ Переподключить'}
                  </button>
                )}

                {a.status === 'active' && (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); disconnectAccount(a.id) }}
                      disabled={isLoading}
                      className="text-zinc-400 text-[10px] border border-zinc-700/50 bg-zinc-800/50 rounded px-3 py-1
                                 hover:bg-zinc-700/50 transition-colors cursor-pointer disabled:opacity-50
                                 disabled:cursor-not-allowed"
                    >
                      ⏹ Отключить
                    </button>
                    <span className="text-blue-400 text-[10px] font-bold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                      Активен
                    </span>
                  </>
                )}
              </div>

              {/* Code input — when awaiting_code */}
              {a.status === 'awaiting_code' && (
                <div className="flex items-center gap-2 mt-2 pl-7" onClick={e => e.stopPropagation()}>
                  <input
                    className="flex-1 min-w-0 bg-zinc-950 border border-yellow-700/50 rounded px-2.5 py-1.5 text-xs text-zinc-200
                               placeholder-zinc-600 focus:outline-none focus:border-yellow-500 transition-colors"
                    placeholder="Код из Telegram"
                    value={codeInputs[a.id] || ''}
                    onChange={e => setCodeInputs(prev => ({ ...prev, [a.id]: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && codeInputs[a.id] && verifyCode(a.id)}
                    autoFocus
                  />
                  <button
                    onClick={() => verifyCode(a.id)}
                    disabled={isLoading || !codeInputs[a.id]}
                    className="bg-yellow-600 hover:bg-yellow-500 disabled:bg-zinc-800 disabled:text-zinc-600
                               text-black font-bold text-xs rounded px-3 py-1.5 transition-colors cursor-pointer
                               disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    {isLoading ? '...' : '✓ Подтвердить'}
                  </button>
                </div>
              )}

              {/* Password input — when awaiting_password (2FA) */}
              {a.status === 'awaiting_password' && (
                <div className="flex flex-col gap-1.5 mt-2 pl-7" onClick={e => e.stopPropagation()}>
                  <span className="text-yellow-400 text-[10px]">
                    Требуется пароль двухфакторной аутентификации (2FA)
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type="password"
                      className="flex-1 min-w-0 bg-zinc-950 border border-yellow-700/50 rounded px-2.5 py-1.5 text-xs text-zinc-200
                                 placeholder-zinc-600 focus:outline-none focus:border-yellow-500 transition-colors"
                      placeholder="Пароль 2FA"
                      value={passwordInputs[a.id] || ''}
                      onChange={e => setPasswordInputs(prev => ({ ...prev, [a.id]: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && passwordInputs[a.id] && verifyPassword(a.id)}
                      autoFocus
                    />
                    <button
                      onClick={() => verifyPassword(a.id)}
                      disabled={isLoading || !passwordInputs[a.id]}
                      className="bg-yellow-600 hover:bg-yellow-500 disabled:bg-zinc-800 disabled:text-zinc-600
                                 text-black font-bold text-xs rounded px-3 py-1.5 transition-colors cursor-pointer
                                 disabled:cursor-not-allowed whitespace-nowrap"
                    >
                      {isLoading ? '...' : '🔑 Войти'}
                    </button>
                  </div>
                </div>
              )}

              {/* Bottom row: mini-stats */}
              {(a.status === 'active' || st.count > 0) && (
                <div className="flex items-center gap-3 mt-2 pl-7">
                  <span className="text-[10px] text-zinc-600">
                    <span className="text-zinc-500">{st.count}</span> камп.
                    {st.active > 0 && <span className="text-blue-400 ml-0.5">({st.active} ▶)</span>}
                  </span>
                  <span className="text-[10px] text-zinc-600">
                    <span className="text-blue-400 font-bold">{st.sent}</span> отпр.
                  </span>
                  {st.errors > 0 && (
                    <span className="text-[10px] text-zinc-600">
                      <span className="text-red-400 font-bold">{st.errors}</span> ошиб.
                    </span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
