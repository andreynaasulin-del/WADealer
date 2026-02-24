'use client'
import { useState, useEffect, useCallback } from 'react'
import { api, type TelegramAccount, type TelegramCampaign, type TelegramStats } from '@/lib/api'
import { useWS, type WSEvent } from '@/hooks/useWS'
import { useAuth } from '@/contexts/AuthContext'
import TelegramAccountManager from '@/components/TelegramAccountManager'
import TelegramCampaignController from '@/components/TelegramCampaignController'
import TelegramQuickSend from '@/components/TelegramQuickSend'
import LiveLogs, { type LogEntry } from '@/components/LiveLogs'

const MAX_LOGS = 500

export default function TelegramDashboard() {
  const { isAuthenticated, isLoading, logout } = useAuth()

  const [accounts, setAccounts]                   = useState<TelegramAccount[]>([])
  const [campaigns, setCampaigns]                 = useState<TelegramCampaign[]>([])
  const [stats, setStats]                         = useState<TelegramStats | null>(null)
  const [logs, setLogs]                           = useState<LogEntry[]>([])
  const [connected, setConnected]                 = useState(false)
  const [time, setTime]                           = useState('')
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)

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

  // ── Data fetchers ─────────────────────────────────────────────────────────

  const loadAccounts = useCallback(async () => {
    try { setAccounts(await api.telegram.accounts.list()) } catch (_) {}
  }, [])

  const loadCampaigns = useCallback(async () => {
    try { setCampaigns(await api.telegram.campaigns.list()) } catch (_) {}
  }, [])

  const loadStats = useCallback(async () => {
    try { setStats(await api.telegram.stats.get()) } catch (_) {}
  }, [])

  useEffect(() => {
    if (!isAuthenticated) return
    loadAccounts()
    loadCampaigns()
    loadStats()
    const timer = setInterval(() => { loadStats(); loadCampaigns(); loadAccounts() }, 15_000)
    return () => clearInterval(timer)
  }, [loadAccounts, loadCampaigns, loadStats, isAuthenticated])

  // ── Auto-select first account if none selected ────────────────────────────
  useEffect(() => {
    if (!selectedAccountId && accounts.length > 0) {
      setSelectedAccountId(accounts[0].id)
    }
    if (selectedAccountId && !accounts.find(a => a.id === selectedAccountId)) {
      setSelectedAccountId(accounts.length > 0 ? accounts[0].id : null)
    }
  }, [accounts, selectedAccountId])

  // ── WebSocket events ──────────────────────────────────────────────────────

  const handleWS = useCallback((event: WSEvent) => {
    setConnected(true)

    switch (event.type) {
      case 'init':
        // Initial state already loaded via API
        break

      case 'log': {
        // Only show Telegram logs
        const logEvent = event as unknown as LogEntry & { platform?: string }
        if (logEvent.platform === 'telegram') {
          setLogs(prev => {
            const next = [...prev, logEvent]
            return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next
          })
        }
        break
      }

      case 'tg_account_update': {
        const { accountId, status, username, first_name, last_name, error_msg } = event as unknown as {
          accountId: string; status: string; username?: string; first_name?: string; last_name?: string; error_msg?: string
        }
        setAccounts(prev =>
          prev.map(a => a.id === accountId ? {
            ...a,
            status: status as TelegramAccount['status'],
            ...(username !== undefined ? { username } : {}),
            ...(first_name !== undefined ? { first_name } : {}),
            ...(last_name !== undefined ? { last_name } : {}),
            ...(error_msg !== undefined ? { error_msg } : {}),
          } : a)
        )
        break
      }

      case 'tg_account_created':
        loadAccounts()
        break

      case 'tg_account_deleted': {
        const { accountId } = event as { accountId: string }
        setAccounts(prev => prev.filter(a => a.id !== accountId))
        break
      }

      case 'tg_campaign_update':
        loadStats()
        loadCampaigns()
        break

      case 'stats_update': {
        const delta = event as { sentDelta?: number; inQueueDelta?: number; errorsDelta?: number; platform?: string }
        if (delta.platform === 'telegram') {
          setStats(prev => {
            if (!prev) return prev
            return {
              ...prev,
              sent_today: prev.sent_today + (delta.sentDelta || 0),
              in_queue: prev.in_queue + (delta.inQueueDelta || 0),
              errors: prev.errors + (delta.errorsDelta || 0),
            }
          })
        }
        break
      }
    }
  }, [loadAccounts, loadStats, loadCampaigns])

  useWS(handleWS)

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
          <a href="/" className="text-zinc-500 hover:text-zinc-300 text-xs transition-colors">
            ← Меню
          </a>
          <span className="text-blue-400 font-bold text-sm tracking-wider">
            ✈ TELEGRAM
          </span>
          <span className="text-zinc-600 text-xs hidden sm:block">
            Управление аккаунтами и рассылками
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs flex items-center gap-1.5 ${connected ? 'text-blue-400' : 'text-zinc-600'}`}>
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${connected ? 'bg-blue-400 pulse' : 'bg-zinc-600'}`} />
            {connected ? 'WS подключён' : 'WS не в сети'}
          </span>
          {time && (
            <span className="text-zinc-700 text-xs hidden md:block tabular-nums">
              {time}
            </span>
          )}
          <button
            onClick={logout}
            className="text-xs text-zinc-600 hover:text-red-400 transition-colors cursor-pointer px-1"
            title="Выйти"
          >
            ⏻
          </button>
        </div>
      </header>

      {/* Stats bar */}
      <div className="border-b border-zinc-800 px-4 py-1.5 shrink-0">
        <div className="flex items-center gap-4 max-w-screen-2xl mx-auto text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-600">Аккаунты:</span>
            <span className="text-blue-400 font-bold">{stats?.accounts_active || 0}</span>
            <span className="text-zinc-600">/ {stats?.accounts_total || 0}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-600">Отправлено сегодня:</span>
            <span className="text-blue-400 font-bold">{stats?.sent_today || 0}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-600">В очереди:</span>
            <span className="text-yellow-400 font-bold">{stats?.in_queue || 0}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-600">Ошибки:</span>
            <span className={`font-bold ${(stats?.errors || 0) > 0 ? 'text-red-400' : 'text-zinc-600'}`}>
              {stats?.errors || 0}
            </span>
          </div>
          {stats?.accounts_error && stats.accounts_error > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-red-400 font-bold">{stats.accounts_error} аккаунт(ов) с ошибкой</span>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 flex flex-col gap-3 p-3 overflow-hidden max-w-screen-2xl mx-auto w-full">
        {/* Main grid — side by side at md (768px+) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 flex-1 min-h-0">
          {/* Module A — Accounts */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 overflow-y-auto">
            <TelegramAccountManager
              accounts={accounts}
              campaigns={campaigns}
              onRefresh={loadAccounts}
              selectedAccountId={selectedAccountId}
              onSelect={setSelectedAccountId}
            />
          </div>

          {/* Module B — Campaigns */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 overflow-y-auto">
            <TelegramCampaignController
              accounts={accounts}
              selectedAccountId={selectedAccountId}
              onStatsRefresh={() => { loadStats(); loadCampaigns() }}
            />
          </div>
        </div>

        {/* Module C — Quick Send */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 shrink-0">
          <TelegramQuickSend
            accounts={accounts}
            selectedAccountId={selectedAccountId}
            onStatsRefresh={() => { loadStats(); loadCampaigns() }}
          />
        </div>

        {/* Module D — Live Logs (Telegram only) */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 shrink-0">
          <LiveLogs entries={logs} onClear={() => setLogs([])} selectedPhone={selectedAccountId} />
        </div>
      </main>
    </div>
  )
}
