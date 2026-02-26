'use client'
import { useState, useEffect, useCallback } from 'react'
import { api, type Session, type Campaign, type Stats, type InviteToken } from '@/lib/api'
import { useWS, type WSEvent } from '@/hooks/useWS'
import { useAuth } from '@/contexts/AuthContext'
import SessionManager from '@/components/SessionManager'
import CampaignController from '@/components/CampaignController'
import LiveLogs, { type LogEntry } from '@/components/LiveLogs'
import StatsBar from '@/components/StatsBar'
import QuickSend from '@/components/QuickSend'
import CRMPanel from '@/components/CRMPanel'
import AIChat from '@/components/AIChat'

const MAX_LOGS = 500

export default function WhatsAppDashboard() {
  const { isAuthenticated, isLoading, logout } = useAuth()

  const [sessions, setSessions]             = useState<Session[]>([])
  const [campaigns, setCampaigns]           = useState<Campaign[]>([])
  const [stats, setStats]                   = useState<Stats | null>(null)
  const [logs, setLogs]                     = useState<LogEntry[]>([])
  const [queueStatus, setQueueStatus]       = useState('stopped')
  const [connected, setConnected]           = useState(false)
  const [time, setTime]                     = useState('')
  const [selectedPhone, setSelectedPhone]   = useState<string | null>(null)

  const [showAdmin, setShowAdmin]           = useState(false)
  const [invites, setInvites]               = useState<InviteToken[]>([])
  const [generatingInvite, setGeneratingInvite] = useState(false)
  const [copiedToken, setCopiedToken]       = useState<string | null>(null)
  const [showCRM, setShowCRM]               = useState(false)
  const [showAI, setShowAI]                 = useState(false)
  const [demoMode, setDemoMode]             = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') setDemoMode(localStorage.getItem('wa_dealer_demo_mode') === '1')
  }, [])

  useEffect(() => {
    if (!isLoading && !isAuthenticated) window.location.href = '/login'
  }, [isAuthenticated, isLoading])

  useEffect(() => {
    const fmt = () => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setTime(fmt())
    const t = setInterval(() => setTime(fmt()), 1000)
    return () => clearInterval(t)
  }, [])

  const loadSessions = useCallback(async () => {
    try { setSessions(await api.sessions.list()) } catch (_) {}
  }, [])

  const loadCampaigns = useCallback(async () => {
    try { setCampaigns(await api.campaigns.list()) } catch (_) {}
  }, [])

  const loadStats = useCallback(async () => {
    try {
      const s = await api.stats.get()
      setStats(s)
      setQueueStatus(s.queue_status)
    } catch (_) {}
  }, [])

  const loadInvites = useCallback(async () => {
    try { setInvites(await api.auth.listInvites()) } catch (_) {}
  }, [])

  useEffect(() => {
    if (!isAuthenticated) return
    loadSessions()
    loadCampaigns()
    loadStats()
    const timer = setInterval(() => { loadStats(); loadCampaigns() }, 15_000)
    return () => clearInterval(timer)
  }, [loadSessions, loadCampaigns, loadStats, isAuthenticated])

  useEffect(() => {
    if (!selectedPhone && sessions.length > 0) setSelectedPhone(sessions[0].phone)
    if (selectedPhone && !sessions.find(s => s.phone === selectedPhone)) {
      setSelectedPhone(sessions.length > 0 ? sessions[0].phone : null)
    }
  }, [sessions, selectedPhone])

  const handleWS = useCallback((event: WSEvent) => {
    setConnected(true)
    switch (event.type) {
      case 'init':
        setSessions(event.sessions as Session[])
        setQueueStatus((event.queue as { status: string }).status)
        break
      case 'log':
        setLogs(prev => {
          const next = [...prev, event as unknown as LogEntry]
          return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next
        })
        break
      case 'session_update': {
        const { phone, status, qrCode } = event as unknown as { phone: string; status: string; qrCode?: string | null }
        setSessions(prev => prev.map(s => s.phone === phone ? { ...s, status: status as Session['status'], qrCode: qrCode !== undefined ? qrCode : s.qrCode } : s))
        break
      }
      case 'session_created': loadSessions(); break
      case 'session_deleted': setSessions(prev => prev.filter(s => s.phone !== event.phone)); break
      case 'qr': {
        const { session: phone, qrCode } = event as unknown as { session: string; qrCode: string }
        setSessions(prev => prev.map(s => s.phone === phone ? { ...s, qrCode, status: 'qr_pending' } : s))
        break
      }
      case 'stats_update':
        setStats(prev => {
          if (!prev) return prev
          const delta = event as unknown as { sentDelta?: number; inQueueDelta?: number; errorsDelta?: number }
          return { ...prev, sent_today: prev.sent_today + (delta.sentDelta || 0), in_queue: prev.in_queue + (delta.inQueueDelta || 0), errors: prev.errors + (delta.errorsDelta || 0) }
        })
        break
      case 'campaign_update':
        setQueueStatus((event.status as string) || queueStatus)
        loadStats(); loadCampaigns()
        break
    }
  }, [loadSessions, loadStats, loadCampaigns, queueStatus])

  useWS(handleWS)

  async function generateInvite() {
    setGeneratingInvite(true)
    try { const invite = await api.auth.generateInvite(); setInvites(prev => [invite, ...prev]) } catch (_) {}
    setGeneratingInvite(false)
  }

  async function deleteInvite(id: string) {
    try { await api.auth.deleteInvite(id); setInvites(prev => prev.filter(i => i.id !== id)) } catch (_) {}
  }

  function copyInviteLink(token: string) {
    navigator.clipboard.writeText(`${window.location.origin}/invite/${token}`).then(() => {
      setCopiedToken(token)
      setTimeout(() => setCopiedToken(null), 2000)
    })
  }

  function toggleAdmin() {
    const next = !showAdmin
    setShowAdmin(next)
    if (next) loadInvites()
  }

  if (isLoading || !isAuthenticated) {
    return (
      <div className="h-screen bg-[#0d1117] flex items-center justify-center">
        <div className="text-[#7d8590] text-sm font-mono">Загрузка...</div>
      </div>
    )
  }

  return (
    <div className="h-screen bg-[#0d1117] text-[#e6edf3] font-mono flex flex-col overflow-hidden">

      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <header className="border-b border-[#30363d] px-2 sm:px-4 py-2 flex items-center justify-between shrink-0 bg-[#161b22]">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <a href="/" className="text-[#7d8590] hover:text-[#e6edf3] text-xs transition-colors shrink-0">
            ← <span className="hidden sm:inline">Меню</span>
          </a>
          <span className="text-green-400 font-bold text-xs sm:text-sm tracking-wider shrink-0">◈ WA</span>
          {demoMode && <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-900/40 border border-amber-700/50 text-amber-400">DEMO</span>}
          <span className="text-[#7d8590] text-xs hidden lg:block truncate">Мульти-сессия WhatsApp рассылки</span>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          <span className={`text-[10px] sm:text-xs flex items-center gap-1 ${connected ? 'text-green-400' : 'text-[#7d8590]'}`}>
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-400' : 'bg-[#7d8590]'}`} />
            <span className="hidden sm:inline">{connected ? 'WS подключён' : 'WS не в сети'}</span>
          </span>
          {time && <span className="text-[#484f58] text-xs hidden md:block tabular-nums">{time}</span>}

          {/* CRM toggle */}
          <button
            onClick={() => setShowCRM(!showCRM)}
            className={`text-[10px] sm:text-xs px-1.5 sm:px-2.5 py-1 rounded border transition-colors cursor-pointer font-medium ${
              showCRM
                ? 'bg-green-900/40 text-green-400 border-green-700'
                : 'text-[#7d8590] border-[#30363d] hover:text-[#e6edf3] hover:border-[#484f58]'
            }`}
          >
            {showCRM ? '✕' : '💬'}<span className="hidden sm:inline"> CRM</span>
          </button>

          {/* AI Chat toggle */}
          <button
            onClick={() => setShowAI(!showAI)}
            className={`text-[10px] sm:text-xs px-1.5 sm:px-2.5 py-1 rounded border transition-colors cursor-pointer font-medium ${
              showAI
                ? 'bg-purple-900/40 text-purple-400 border-purple-700'
                : 'text-[#7d8590] border-[#30363d] hover:text-[#e6edf3] hover:border-[#484f58]'
            }`}
          >
            {showAI ? '✕' : '🤖'}<span className="hidden sm:inline"> AI</span>
          </button>

          {/* Admin toggle */}
          <button
            onClick={toggleAdmin}
            className={`text-[10px] sm:text-xs px-1.5 sm:px-2.5 py-1 rounded border transition-colors cursor-pointer font-medium ${
              showAdmin
                ? 'bg-amber-900/40 text-amber-400 border-amber-700'
                : 'text-[#7d8590] border-[#30363d] hover:text-[#e6edf3] hover:border-[#484f58]'
            }`}
          >
            {showAdmin ? '✕' : '⚙'}<span className="hidden sm:inline"> Админ</span>
          </button>

          {/* Logout */}
          <button onClick={logout} className="text-xs text-[#7d8590] hover:text-red-400 transition-colors cursor-pointer px-1" title="Выйти">
            ⏻
          </button>
        </div>
      </header>

      {/* ── Admin panel ───────────────────────────────────────────────────────── */}
      {showAdmin && (
        <div className="border-b border-[#30363d] bg-[#161b22] px-4 py-3 shrink-0">
          <div className="max-w-screen-2xl mx-auto">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-amber-400 font-bold tracking-widest uppercase text-xs">⚙ Управление приглашениями</span>
              <button
                onClick={generateInvite}
                disabled={generatingInvite}
                className="bg-amber-600 hover:bg-amber-500 disabled:bg-[#21262d] disabled:text-[#484f58]
                           text-black font-bold text-xs rounded px-3 py-1 transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                {generatingInvite ? '...' : '+ Создать приглашение'}
              </button>
            </div>
            {invites.length === 0 ? (
              <p className="text-[#7d8590] text-xs">Нет приглашений. Создайте первое.</p>
            ) : (
              <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
                {invites.map(inv => (
                  <div key={inv.id} className={`flex items-center gap-2 text-xs px-2 py-1.5 rounded border ${
                    inv.is_used ? 'border-[#30363d] bg-[#0d1117] text-[#484f58]' : 'border-green-900/50 bg-green-950/20 text-[#e6edf3]'
                  }`}>
                    <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${inv.is_used ? 'bg-[#484f58]' : 'bg-green-400'}`} />
                    <code className="font-mono text-[10px] bg-[#0d1117] px-1.5 py-0.5 rounded border border-[#30363d] truncate max-w-[200px]">
                      {inv.token.slice(0, 16)}...{inv.token.slice(-8)}
                    </code>
                    {inv.label && <span className="text-[#7d8590] text-[10px] truncate max-w-[120px]">{inv.label}</span>}
                    <span className={`text-[10px] ${inv.is_used ? 'text-[#484f58]' : 'text-green-600'}`}>
                      {inv.is_used ? `Использован ${inv.used_at ? new Date(inv.used_at).toLocaleDateString('ru') : ''}` : 'Активен'}
                    </span>
                    <div className="flex-1" />
                    {!inv.is_used && (
                      <button onClick={() => copyInviteLink(inv.token)} className="text-[10px] text-blue-400 hover:text-blue-300 cursor-pointer shrink-0">
                        {copiedToken === inv.token ? '✓ Скопировано!' : '📋 Копировать ссылку'}
                      </button>
                    )}
                    <button onClick={() => deleteInvite(inv.id)} className="text-[10px] text-[#7d8590] hover:text-red-400 cursor-pointer shrink-0">✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Main area: CRM sidebar + scrollable content ───────────────────────── */}
      <main className="flex-1 flex overflow-hidden min-h-0 relative">

        {/* CRM — full-screen overlay on mobile, sidebar on desktop */}
        {showCRM && (
          <>
            {/* Mobile: full-screen overlay */}
            <div className="md:hidden fixed inset-0 z-40 bg-[#0d1117] flex flex-col overflow-hidden"
                 style={{ top: 'var(--header-h, 44px)' }}>
              <CRMPanel
                sessions={sessions}
                selectedPhone={selectedPhone}
                onClose={() => setShowCRM(false)}
              />
            </div>
            {/* Desktop: sidebar */}
            <aside className="hidden md:flex w-80 xl:w-96 shrink-0 border-r border-[#30363d] flex-col overflow-hidden bg-[#0d1117]">
              <CRMPanel
                sessions={sessions}
                selectedPhone={selectedPhone}
                onClose={() => setShowCRM(false)}
              />
            </aside>
          </>
        )}

        {/* AI Chat — full-screen overlay on mobile, sidebar on desktop (RIGHT side) */}
        {showAI && (
          <>
            {/* Mobile: full-screen overlay */}
            <div className="md:hidden fixed inset-0 z-40 bg-[#0d1117] flex flex-col overflow-hidden"
                 style={{ top: 'var(--header-h, 44px)' }}>
              <AIChat
                campaigns={campaigns}
                onClose={() => setShowAI(false)}
              />
            </div>
            {/* Desktop: sidebar on right */}
            <aside className="hidden md:flex w-80 xl:w-96 shrink-0 border-l border-[#30363d] flex-col overflow-hidden bg-[#161b22] order-last">
              <AIChat
                campaigns={campaigns}
                onClose={() => setShowAI(false)}
              />
            </aside>
          </>
        )}

        {/* Scrollable content */}
        <div className="flex-1 flex flex-col gap-2 sm:gap-3 p-2 sm:p-3 overflow-y-auto min-w-0">

          {/* Stats bar */}
          <StatsBar stats={stats} queueStatus={queueStatus} />

          {/* Sessions + Campaigns grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 sm:gap-3">
            <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-3 sm:p-4 overflow-y-auto max-h-[360px] sm:max-h-[480px]">
              <SessionManager
                sessions={sessions}
                campaigns={campaigns}
                onRefresh={loadSessions}
                selectedPhone={selectedPhone}
                onSelect={setSelectedPhone}
              />
            </div>
            <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-3 sm:p-4 overflow-y-auto max-h-[360px] sm:max-h-[480px]">
              <CampaignController
                sessions={sessions}
                selectedPhone={selectedPhone}
                onStatsRefresh={() => { loadStats(); loadCampaigns() }}
              />
            </div>
          </div>

          {/* Quick Send / Import */}
          <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-3 sm:p-4">
            <QuickSend sessions={sessions} campaigns={campaigns} selectedPhone={selectedPhone} onStatsRefresh={() => { loadStats(); loadCampaigns() }} />
          </div>

          {/* Live Logs */}
          <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-3 sm:p-4">
            <LiveLogs entries={logs} onClear={() => setLogs([])} selectedPhone={selectedPhone} />
          </div>

        </div>
      </main>
    </div>
  )
}
