'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { api, type Stats, type InviteToken } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

export default function PlatformSelector() {
  const router = useRouter()
  const { isAuthenticated, isLoading, logout } = useAuth()

  const [waStats, setWaStats]                     = useState<Stats | null>(null)
  const [tgAccountCount, setTgAccountCount]       = useState<number>(0)
  const [tgActiveAccounts, setTgActiveAccounts]   = useState<number>(0)
  const [time, setTime]                           = useState('')

  // ── Admin panel state ─────────────────────────────────────────────────────
  const [showAdmin, setShowAdmin]           = useState(false)
  const [invites, setInvites]               = useState<InviteToken[]>([])
  const [generatingInvite, setGeneratingInvite] = useState(false)
  const [copiedToken, setCopiedToken]       = useState<string | null>(null)

  // ── Auth redirect ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      window.location.href = '/login'
    }
  }, [isAuthenticated, isLoading])

  // ── Clock ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const fmt = () => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setTime(fmt())
    const t = setInterval(() => setTime(fmt()), 1000)
    return () => clearInterval(t)
  }, [])

  // ── Load stats ────────────────────────────────────────────────────────────
  const loadWaStats = useCallback(async () => {
    try { setWaStats(await api.stats.get()) } catch (_) {}
  }, [])

  const loadTgStats = useCallback(async () => {
    try {
      const stats = await api.telegram.stats.get()
      setTgAccountCount(stats.accounts_total || 0)
      setTgActiveAccounts(stats.accounts_active || 0)
    } catch (_) {}
  }, [])

  const loadInvites = useCallback(async () => {
    try { setInvites(await api.auth.listInvites()) } catch (_) {}
  }, [])

  useEffect(() => {
    if (!isAuthenticated) return
    loadWaStats()
    loadTgStats()
    const timer = setInterval(() => { loadWaStats(); loadTgStats() }, 15_000)
    return () => clearInterval(timer)
  }, [loadWaStats, loadTgStats, isAuthenticated])

  // ── Admin handlers ────────────────────────────────────────────────────────

  async function generateInvite() {
    setGeneratingInvite(true)
    try {
      const invite = await api.auth.generateInvite()
      setInvites(prev => [invite, ...prev])
    } catch (_) {}
    setGeneratingInvite(false)
  }

  async function deleteInvite(id: string) {
    try {
      await api.auth.deleteInvite(id)
      setInvites(prev => prev.filter(i => i.id !== id))
    } catch (_) {}
  }

  function copyInviteLink(token: string) {
    const link = `${window.location.origin}/invite/${token}`
    navigator.clipboard.writeText(link).then(() => {
      setCopiedToken(token)
      setTimeout(() => setCopiedToken(null), 2000)
    })
  }

  function toggleAdmin() {
    const next = !showAdmin
    setShowAdmin(next)
    if (next) loadInvites()
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (isLoading || !isAuthenticated) {
    return (
      <div className="h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-600 text-sm font-mono">Загрузка...</div>
      </div>
    )
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen bg-zinc-950 text-zinc-200 font-mono flex flex-col overflow-hidden">
      {/* Header */}
      <header className="border-b border-zinc-800 px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-green-400 font-bold text-sm tracking-wider">
            ◈ WA DEALER
          </span>
          <span className="text-zinc-600 text-xs hidden sm:block">
            Мульти-платформа рассылки
          </span>
        </div>
        <div className="flex items-center gap-3">
          {time && (
            <span className="text-zinc-700 text-xs hidden md:block tabular-nums">
              {time}
            </span>
          )}
          <button
            onClick={toggleAdmin}
            className={`text-xs px-2 py-0.5 rounded border transition-colors cursor-pointer ${
              showAdmin
                ? 'bg-amber-900/40 text-amber-400 border-amber-800'
                : 'text-zinc-600 border-zinc-800 hover:text-zinc-400 hover:border-zinc-700'
            }`}
          >
            {showAdmin ? '✕ Закрыть' : '⚙ Админ'}
          </button>
          <button
            onClick={logout}
            className="text-xs text-zinc-600 hover:text-red-400 transition-colors cursor-pointer px-1"
            title="Выйти"
          >
            ⏻
          </button>
        </div>
      </header>

      {/* Admin panel — invite management */}
      {showAdmin && (
        <div className="border-b border-zinc-800 bg-zinc-900/70 px-4 py-3 shrink-0">
          <div className="max-w-screen-2xl mx-auto">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-amber-400 font-bold tracking-widest uppercase text-xs">⚙ Управление приглашениями</span>
              <button
                onClick={generateInvite}
                disabled={generatingInvite}
                className="bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-800 disabled:text-zinc-600
                           text-black font-bold text-xs rounded px-3 py-1 transition-colors cursor-pointer
                           disabled:cursor-not-allowed"
              >
                {generatingInvite ? '...' : '+ Создать приглашение'}
              </button>
            </div>

            {invites.length === 0 ? (
              <p className="text-zinc-600 text-xs">Нет приглашений. Создайте первое.</p>
            ) : (
              <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
                {invites.map(inv => (
                  <div
                    key={inv.id}
                    className={`flex items-center gap-2 text-xs px-2 py-1.5 rounded border ${
                      inv.is_used
                        ? 'border-zinc-800 bg-zinc-900/30 text-zinc-600'
                        : 'border-green-900/50 bg-green-950/20 text-zinc-300'
                    }`}
                  >
                    <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                      inv.is_used ? 'bg-zinc-700' : 'bg-green-400'
                    }`} />
                    <code className="font-mono text-[10px] bg-zinc-950 px-1.5 py-0.5 rounded border border-zinc-800 truncate max-w-[200px]">
                      {inv.token.slice(0, 16)}...{inv.token.slice(-8)}
                    </code>
                    {inv.label && (
                      <span className="text-zinc-500 text-[10px] truncate max-w-[120px]">{inv.label}</span>
                    )}
                    <span className={`text-[10px] ${inv.is_used ? 'text-zinc-700' : 'text-green-600'}`}>
                      {inv.is_used ? `Использован ${inv.used_at ? new Date(inv.used_at).toLocaleDateString('ru') : ''}` : 'Активен'}
                    </span>
                    <div className="flex-1" />
                    {!inv.is_used && (
                      <button
                        onClick={() => copyInviteLink(inv.token)}
                        className="text-[10px] text-blue-400 hover:text-blue-300 cursor-pointer shrink-0"
                      >
                        {copiedToken === inv.token ? '✓ Скопировано!' : '📋 Копировать ссылку'}
                      </button>
                    )}
                    <button
                      onClick={() => deleteInvite(inv.id)}
                      className="text-[10px] text-zinc-600 hover:text-red-400 cursor-pointer shrink-0"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Platform cards — centered */}
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-8">
          {/* Title */}
          <div className="text-center">
            <h1 className="text-zinc-400 text-lg tracking-widest uppercase mb-1">Выберите платформу</h1>
            <p className="text-zinc-600 text-xs">Управление рассылками и сессиями</p>
          </div>

          {/* Cards */}
          <div className="flex flex-col sm:flex-row gap-6">
            {/* WhatsApp Card */}
            <button
              onClick={() => router.push('/whatsapp')}
              className="group relative w-64 h-48 bg-zinc-900/60 border border-zinc-800 rounded-xl p-6
                         hover:border-green-700/60 hover:bg-green-950/20 transition-all duration-300
                         cursor-pointer flex flex-col items-center justify-center gap-4"
            >
              {/* Glow effect on hover */}
              <div className="absolute inset-0 rounded-xl bg-green-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

              {/* Icon */}
              <div className="relative text-4xl">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-12 h-12 text-green-500 group-hover:text-green-400 transition-colors">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
              </div>

              {/* Text */}
              <div className="relative text-center">
                <h2 className="text-green-400 font-bold text-base tracking-wider mb-1">WhatsApp</h2>
                <p className="text-zinc-500 text-xs">
                  {waStats
                    ? `${waStats.sessions_total} сессий · ${waStats.sessions_online} онлайн`
                    : 'Загрузка...'
                  }
                </p>
              </div>

              {/* Status indicator */}
              {waStats && waStats.sessions_online > 0 && (
                <div className="absolute top-3 right-3">
                  <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                </div>
              )}
            </button>

            {/* Telegram Card */}
            <button
              onClick={() => router.push('/telegram')}
              className="group relative w-64 h-48 bg-zinc-900/60 border border-zinc-800 rounded-xl p-6
                         hover:border-blue-700/60 hover:bg-blue-950/20 transition-all duration-300
                         cursor-pointer flex flex-col items-center justify-center gap-4"
            >
              {/* Glow effect on hover */}
              <div className="absolute inset-0 rounded-xl bg-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

              {/* Icon */}
              <div className="relative text-4xl">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-12 h-12 text-blue-400 group-hover:text-blue-300 transition-colors">
                  <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                </svg>
              </div>

              {/* Text */}
              <div className="relative text-center">
                <h2 className="text-blue-400 font-bold text-base tracking-wider mb-1">Telegram</h2>
                <p className="text-zinc-500 text-xs">
                  {tgAccountCount > 0
                    ? `${tgAccountCount} аккаунтов · ${tgActiveAccounts} активных`
                    : 'Добавьте первый аккаунт'
                  }
                </p>
              </div>

              {/* Status indicator */}
              {tgActiveAccounts > 0 && (
                <div className="absolute top-3 right-3">
                  <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                </div>
              )}
            </button>
          </div>

          {/* Footer hint */}
          <p className="text-zinc-700 text-[10px] tracking-wider uppercase">
            Нажмите на карточку для перехода к управлению
          </p>
        </div>
      </main>
    </div>
  )
}
