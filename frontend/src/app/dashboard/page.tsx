'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { api, type DashboardStats, type Tier } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

export default function DashboardPage() {
  const router = useRouter()
  const { isAuthenticated, isLoading, logout } = useAuth()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [tiers, setTiers] = useState<Tier[]>([])
  const [time, setTime] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isLoading && !isAuthenticated) window.location.href = '/login'
  }, [isAuthenticated, isLoading])

  useEffect(() => {
    const fmt = () => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setTime(fmt())
    const t = setInterval(() => setTime(fmt()), 1000)
    return () => clearInterval(t)
  }, [])

  const loadStats = useCallback(async () => {
    try {
      setError(null)
      const data = await api.dashboard.get()
      setStats(data)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  const loadTiers = useCallback(async () => {
    try {
      const data = await api.dashboard.tiers()
      setTiers(data)
    } catch (_) {}
  }, [])

  useEffect(() => {
    if (!isAuthenticated) return
    loadStats()
    loadTiers()
    const timer = setInterval(loadStats, 10_000)
    return () => clearInterval(timer)
  }, [loadStats, loadTiers, isAuthenticated])

  if (isLoading || !isAuthenticated) {
    return (
      <div className="h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-600 text-sm font-mono">Загрузка...</div>
      </div>
    )
  }

  const hb = stats?.heartbeat
  const totalAlive = (hb?.tg_alive || 0) + (hb?.wa_alive || 0)
  const totalDead = (hb?.tg_dead || 0) + (hb?.wa_dead || 0)

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 font-mono">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push('/')} className="text-zinc-600 hover:text-zinc-400 transition-colors cursor-pointer text-sm">
            ← Назад
          </button>
          <span className="text-green-400 font-bold text-sm tracking-wider">
            DASHBOARD
          </span>
          <span className="text-zinc-600 text-xs hidden sm:block">
            Панель управления WADealer
          </span>
        </div>
        <div className="flex items-center gap-4">
          {time && <span className="text-zinc-700 text-xs tabular-nums">{time}</span>}
          <div className="flex items-center gap-2">
            <span className={`inline-block w-2 h-2 rounded-full ${totalDead > 0 ? 'bg-yellow-400' : 'bg-green-400'} ${totalAlive > 0 ? 'animate-pulse' : ''}`} />
            <span className="text-xs text-zinc-500">
              {totalAlive} живых {totalDead > 0 && `/ ${totalDead} мёртвых`}
            </span>
          </div>
          <button onClick={logout} className="text-xs text-zinc-600 hover:text-red-400 transition-colors cursor-pointer px-1" title="Выйти">
            ⏻
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 space-y-6">
        {error && (
          <div className="bg-red-950/30 border border-red-500/40 rounded-lg px-4 py-3 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* ── KPI Cards ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <StatCard label="TG аккаунты" value={stats?.telegram.accounts_active || 0} suffix={`/ ${stats?.telegram.accounts_total || 0}`} color="blue" />
          <StatCard label="WA сессии" value={stats?.whatsapp.sessions_online || 0} suffix={`/ ${stats?.whatsapp.sessions_total || 0}`} color="green" />
          <StatCard label="TG очередь" value={stats?.queues.tg.size || 0} suffix={stats?.queues.tg.status === 'running' ? 'RUN' : 'STOP'} color={stats?.queues.tg.status === 'running' ? 'green' : 'zinc'} />
          <StatCard label="WA очередь" value={stats?.queues.wa.size || 0} suffix={stats?.queues.wa.status === 'running' ? 'RUN' : 'STOP'} color={stats?.queues.wa.status === 'running' ? 'green' : 'zinc'} />
          <StatCard label="Спарсено" value={stats?.scraped.total || 0} suffix={`${stats?.scraped.pending || 0} pending`} color="purple" />
          <StatCard label="Приглашено" value={stats?.scraped.invited || 0} suffix={`${stats?.scraped.failed || 0} fail`} color="amber" />
        </div>

        {/* ── Two-column: Heartbeat + Campaigns ─────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Heartbeat Monitor */}
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5">
            <h2 className="text-sm font-bold text-zinc-400 tracking-wider uppercase mb-4">
              Heartbeat Monitor
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <span className="text-xs text-blue-400 font-bold">Telegram</span>
                <div className="flex items-center gap-2">
                  <span className={`w-3 h-3 rounded-full ${(hb?.tg_alive || 0) > 0 ? 'bg-green-400 animate-pulse' : 'bg-zinc-700'}`} />
                  <span className="text-sm">{hb?.tg_alive || 0} active</span>
                </div>
                {(hb?.tg_dead || 0) > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-red-400" />
                    <span className="text-sm text-red-400">{hb?.tg_dead} disconnected</span>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <span className="text-xs text-green-400 font-bold">WhatsApp</span>
                <div className="flex items-center gap-2">
                  <span className={`w-3 h-3 rounded-full ${(hb?.wa_alive || 0) > 0 ? 'bg-green-400 animate-pulse' : 'bg-zinc-700'}`} />
                  <span className="text-sm">{hb?.wa_alive || 0} online</span>
                </div>
                {(hb?.wa_dead || 0) > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-red-400" />
                    <span className="text-sm text-red-400">{hb?.wa_dead} offline</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Campaign Status */}
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5">
            <h2 className="text-sm font-bold text-zinc-400 tracking-wider uppercase mb-4">
              Кампании
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <span className="text-xs text-green-400 font-bold">WhatsApp</span>
                <div className="text-2xl font-bold text-zinc-200">
                  {stats?.campaigns.wa_running || 0}
                  <span className="text-sm text-zinc-500 ml-1">/ {stats?.campaigns.wa_total || 0}</span>
                </div>
                <span className="text-xs text-zinc-600">активных кампаний</span>
              </div>
              <div className="space-y-2">
                <span className="text-xs text-blue-400 font-bold">Telegram</span>
                <div className="text-2xl font-bold text-zinc-200">
                  {stats?.campaigns.tg_running || 0}
                  <span className="text-sm text-zinc-500 ml-1">/ {stats?.campaigns.tg_total || 0}</span>
                </div>
                <span className="text-xs text-zinc-600">активных кампаний</span>
              </div>
            </div>

            {/* Invite status */}
            {stats?.invite && stats.invite.status !== 'idle' && (
              <div className="mt-4 pt-4 border-t border-zinc-800">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${stats.invite.status === 'running' ? 'bg-green-400 animate-pulse' : stats.invite.status === 'rate_limited' ? 'bg-red-400' : 'bg-zinc-600'}`} />
                  <span className="text-xs text-zinc-400">
                    Инвайт: {stats.invite.status} — {stats.invite.invited || 0} приглашено, {stats.invite.failed || 0} ошибок
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Quick Navigation ─────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <NavCard label="WhatsApp" description="Сессии и рассылки" href="/whatsapp" color="green" icon="WA" />
          <NavCard label="Telegram" description="Аккаунты и инвайтинг" href="/telegram" color="blue" icon="TG" />
          <NavCard label="CRM" description="Диалоги и ответы" href="/crm" color="purple" icon="CRM" />
          <NavCard label="Настройки" description="Аккаунты и прокси" href="/telegram" color="amber" icon="CFG" />
        </div>

        {/* ── Tier System ─────────────────────────────────────────── */}
        {tiers.length > 0 && (
          <div>
            <h2 className="text-sm font-bold text-zinc-400 tracking-wider uppercase mb-4">
              Тарифные планы
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {tiers.map(tier => (
                <div key={tier.id} className={`bg-zinc-900/60 border rounded-xl p-5 ${
                  tier.id === 'pro' ? 'border-green-500/40 ring-1 ring-green-500/20' : 'border-zinc-800'
                }`}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className={`font-bold text-base ${
                      tier.id === 'start' ? 'text-zinc-400' : tier.id === 'pro' ? 'text-green-400' : 'text-amber-400'
                    }`}>{tier.display_name}</h3>
                    {tier.id === 'pro' && (
                      <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full font-bold">
                        POPULAR
                      </span>
                    )}
                  </div>
                  <div className="text-2xl font-bold text-zinc-200 mb-4">
                    {tier.price_monthly > 0 ? `$${tier.price_monthly}` : 'Free'}
                    {tier.price_monthly > 0 && <span className="text-xs text-zinc-500 ml-1">/мес</span>}
                  </div>
                  <div className="space-y-2 text-xs text-zinc-400">
                    <div className="flex justify-between">
                      <span>TG аккаунты</span>
                      <span className="text-zinc-200 font-bold">{tier.max_tg_accounts}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>WA сессии</span>
                      <span className="text-zinc-200 font-bold">{tier.max_wa_sessions}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Сообщений/день</span>
                      <span className="text-zinc-200 font-bold">{tier.max_daily_messages}</span>
                    </div>
                    <div className="pt-2 border-t border-zinc-800 space-y-1">
                      {Object.entries(tier.features).map(([key, val]) => (
                        <div key={key} className="flex items-center gap-2">
                          <span className={val ? 'text-green-400' : 'text-zinc-700'}>{val ? '✓' : '✗'}</span>
                          <span className={val ? 'text-zinc-300' : 'text-zinc-700'}>{formatFeature(key)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function formatFeature(key: string): string {
  const map: Record<string, string> = {
    inviting: 'Инвайтинг',
    mass_dm: 'Массовая рассылка',
    story_liking: 'Лайки сторис',
    neuro_commenting: 'Нейрокомментинг',
  }
  return map[key] || key
}

function StatCard({ label, value, suffix, color }: {
  label: string; value: number; suffix?: string; color: string
}) {
  const colorMap: Record<string, string> = {
    green: 'border-green-500/30 text-green-400',
    blue: 'border-blue-500/30 text-blue-400',
    purple: 'border-purple-500/30 text-purple-400',
    amber: 'border-amber-500/30 text-amber-400',
    red: 'border-red-500/30 text-red-400',
    zinc: 'border-zinc-700 text-zinc-400',
  }
  return (
    <div className={`bg-zinc-900/60 border ${colorMap[color] || colorMap.zinc} rounded-lg p-3`}>
      <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className={`text-xl font-bold ${colorMap[color]?.split(' ')[1] || 'text-zinc-200'}`}>{value}</span>
        {suffix && <span className="text-[10px] text-zinc-600">{suffix}</span>}
      </div>
    </div>
  )
}

function NavCard({ label, description, href, color, icon }: {
  label: string; description: string; href: string; color: string; icon: string
}) {
  const router = useRouter()
  const colorMap: Record<string, string> = {
    green: 'hover:border-green-500/40 hover:bg-green-950/10',
    blue: 'hover:border-blue-500/40 hover:bg-blue-950/10',
    purple: 'hover:border-purple-500/40 hover:bg-purple-950/10',
    amber: 'hover:border-amber-500/40 hover:bg-amber-950/10',
  }
  const textColor: Record<string, string> = {
    green: 'text-green-400',
    blue: 'text-blue-400',
    purple: 'text-purple-400',
    amber: 'text-amber-400',
  }
  return (
    <button
      onClick={() => router.push(href)}
      className={`bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 text-left transition-all duration-200 cursor-pointer ${colorMap[color] || ''}`}
    >
      <div className={`text-xs font-bold ${textColor[color] || 'text-zinc-400'} mb-1`}>{icon}</div>
      <div className="text-sm font-bold text-zinc-200">{label}</div>
      <div className="text-[10px] text-zinc-600 mt-0.5">{description}</div>
    </button>
  )
}
