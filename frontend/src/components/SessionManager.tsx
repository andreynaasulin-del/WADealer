'use client'
import { useState } from 'react'
import { api, type Session, type Campaign } from '@/lib/api'

const STATUS_BORDER: Record<string, string> = {
  online:          'border-green-500/40',
  qr_pending:      'border-yellow-500/40',
  pairing_pending: 'border-purple-500/40',
  initializing:    'border-blue-500/40',
  offline:         'border-zinc-700',
  banned:          'border-red-500/40',
}

const STATUS_BG: Record<string, string> = {
  online:          'bg-green-950/20',
  qr_pending:      'bg-yellow-950/20',
  pairing_pending: 'bg-purple-950/20',
  initializing:    'bg-blue-950/20',
  offline:         'bg-zinc-900',
  banned:          'bg-red-950/20',
}

const STATUS_DOT: Record<string, string> = {
  online:          'bg-green-400',
  qr_pending:      'bg-yellow-400 animate-pulse',
  pairing_pending: 'bg-purple-400 animate-pulse',
  initializing:    'bg-blue-400 animate-pulse',
  offline:         'bg-zinc-600',
  banned:          'bg-red-500',
}

const STATUS_LABELS: Record<string, string> = {
  online:          'В сети',
  qr_pending:      'Ожидает QR',
  pairing_pending: 'Ожидает код',
  initializing:    'Подключение...',
  offline:         'Не в сети',
  banned:          'Заблокирован',
}

const STATUS_LABEL_COLOR: Record<string, string> = {
  online:          'text-green-400',
  qr_pending:      'text-yellow-400',
  pairing_pending: 'text-purple-400',
  initializing:    'text-blue-400',
  offline:         'text-zinc-500',
  banned:          'text-red-400',
}

// ── Ban-risk analyser ─────────────────────────────────────────────────────────
type RiskLevel = 'unknown' | 'low' | 'medium' | 'high' | 'banned'

interface RiskResult {
  level: RiskLevel
  score: number        // 0–100
  label: string
  reasons: string[]
}

function calcBanRisk(session: Session, campaigns: Campaign[]): RiskResult {
  if (session.status === 'banned') {
    return { level: 'banned', score: 100, label: 'Заблокирован', reasons: ['Аккаунт уже заблокирован'] }
  }

  const sc = campaigns.filter(c => c.session_id === session.id)
  const active = sc.filter(c => c.status === 'running')
  const totalSent   = sc.reduce((s, c) => s + (c.total_sent   || 0), 0)
  const totalErrors = sc.reduce((s, c) => s + (c.total_errors || 0), 0)

  let score = 0
  const reasons: string[] = []

  // 1. Error rate
  if (totalSent > 0) {
    const errPct = totalErrors / totalSent
    if (errPct >= 0.15)      { score += 35; reasons.push(`Ошибки доставки ${Math.round(errPct * 100)}% ↑`) }
    else if (errPct >= 0.07) { score += 18; reasons.push(`Ошибки доставки ${Math.round(errPct * 100)}%`) }
  }

  // 2. Active campaigns count
  if (active.length >= 3)      { score += 25; reasons.push(`${active.length} кампании одновременно`) }
  else if (active.length === 2) { score += 12; reasons.push('2 кампании параллельно') }

  // 3. Sending speed (average delay across active campaigns)
  for (const c of active) {
    const avg = ((c.delay_min_sec || 60) + (c.delay_max_sec || 120)) / 2
    if (avg < 45)       { score += 30; reasons.push('Задержка < 45с — очень быстро') }
    else if (avg < 90)  { score += 15; reasons.push('Задержка < 90с — быстро') }
    else if (avg < 180) { score += 5 }
  }

  // 4. High volume
  if (totalSent >= 2000)      { score += 15; reasons.push(`Отправлено ${totalSent.toLocaleString()} сообщений`) }
  else if (totalSent >= 500)  { score += 7 }

  // 5. No proxy
  if (!session.proxyPort)     { score += 10; reasons.push('Нет прокси-сервера') }

  score = Math.min(100, score)

  if (score === 0 && totalSent === 0) {
    return { level: 'unknown', score: 0, label: 'Нет данных', reasons: ['Рассылка не запускалась'] }
  }

  const level: RiskLevel = score >= 60 ? 'high' : score >= 28 ? 'medium' : 'low'
  const label = level === 'high' ? 'Высокий' : level === 'medium' ? 'Средний' : 'Низкий'
  return { level, score, label, reasons }
}

const RISK_STYLE: Record<RiskLevel, string> = {
  unknown: 'text-zinc-500 border-zinc-700 bg-zinc-800/40',
  low:     'text-green-400 border-green-700/50 bg-green-950/30',
  medium:  'text-yellow-400 border-yellow-600/50 bg-yellow-950/30',
  high:    'text-red-400 border-red-600/50 bg-red-950/30 animate-pulse',
  banned:  'text-red-500 border-red-500/60 bg-red-950/40',
}

const RISK_ICON: Record<RiskLevel, string> = {
  unknown: '?',
  low:     '●',
  medium:  '▲',
  high:    '⚠',
  banned:  '✕',
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
  sessions: Session[]
  campaigns: Campaign[]
  onRefresh: () => void
  selectedPhone: string | null
  onSelect: (phone: string) => void
  pairingCodes?: Record<string, string>
  onPairingCodeUsed?: (phone: string) => void
}

export default function SessionManager({ sessions, campaigns, onRefresh, selectedPhone, onSelect, pairingCodes = {}, onPairingCodeUsed }: Props) {
  const [phone, setPhone]                   = useState('')
  const [loading, setLoading]               = useState(false)
  const [error, setError]                   = useState<string | null>(null)
  const [qrModal, setQrModal]               = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm]   = useState<string | null>(null)
  const [connecting, setConnecting]         = useState<string | null>(null)
  const [riskTooltip, setRiskTooltip]       = useState<string | null>(null)
  const [connectMode, setConnectMode]       = useState<Record<string, 'qr' | 'code'>>({})
  const [requestingCode, setRequestingCode] = useState<string | null>(null)

  async function addSession() {
    if (!phone.trim()) return
    setLoading(true); setError(null)
    try {
      await api.sessions.create(phone.trim())
      setPhone('')
      onRefresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setLoading(false)
    }
  }

  async function connectSession(p: string) {
    setConnecting(p); setError(null)
    try {
      await api.sessions.connect(p)
      onRefresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка подключения')
    } finally {
      setConnecting(null)
    }
  }

  async function removeSession(p: string) {
    if (deleteConfirm !== p) {
      setDeleteConfirm(p)
      setTimeout(() => setDeleteConfirm(prev => prev === p ? null : prev), 3000)
      return
    }
    setDeleteConfirm(null); setError(null)
    try {
      await api.sessions.remove(p)
      onRefresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка удаления')
    }
  }

  async function showQR(p: string) {
    try {
      const res = await api.sessions.qr(p)
      if (res?.qrCode) setQrModal(res.qrCode)
      else setError('QR ещё не готов — подожди пару секунд и попробуй снова')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки QR')
    }
  }

  async function requestPairingCode(p: string) {
    setRequestingCode(p); setError(null)
    try {
      await api.sessions.pairingCode(p)
      // Code arrives via WebSocket pairing_code event
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка запроса кода')
    } finally {
      setRequestingCode(null)
    }
  }

  async function reconnectAndShowQR(p: string) {
    setConnecting(p); setError(null)
    try {
      await api.sessions.connect(p)
      // Wait for QR to generate then try to show it
      await new Promise(r => setTimeout(r, 3000))
      const res = await api.sessions.qr(p)
      if (res?.qrCode) setQrModal(res.qrCode)
      onRefresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка переподключения')
    } finally {
      setConnecting(null)
    }
  }

  /** Get per-session stats from campaigns */
  function getSessionStats(session: Session) {
    const sessionCampaigns = campaigns.filter(c => c.session_id === session.id)
    const activeCampaigns = sessionCampaigns.filter(c => c.status === 'running').length
    const totalSent = sessionCampaigns.reduce((sum, c) => sum + c.total_sent, 0)
    const totalErrors = sessionCampaigns.reduce((sum, c) => sum + c.total_errors, 0)
    const totalLeads = sessionCampaigns.reduce((sum, c) => sum + c.total_leads, 0)
    return { count: sessionCampaigns.length, active: activeCampaigns, sent: totalSent, errors: totalErrors, leads: totalLeads }
  }

  const onlineCount = sessions.filter(s => s.status === 'online').length

  return (
    <section className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-green-400 font-bold tracking-widest uppercase text-xs">▸ Менеджер сессий</span>
        <div className="flex items-center gap-2">
          {sessions.length > 0 && (
            <span className="text-green-400 text-[10px] font-bold bg-green-950/30 border border-green-800/40 rounded px-1.5 py-0.5">
              {onlineCount}/{sessions.length} в сети
            </span>
          )}
        </div>
      </div>

      {/* Add — just phone number */}
      <div className="flex gap-2">
        <input
          className="flex-1 min-w-0 bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-200
                     placeholder-zinc-600 focus:outline-none focus:border-green-500 transition-colors"
          placeholder="+972XXXXXXXXX"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && phone && !loading && addSession()}
        />
        <button
          onClick={addSession}
          disabled={loading || !phone}
          className="bg-green-600 hover:bg-green-500 disabled:bg-zinc-800 disabled:text-zinc-600
                     text-black font-bold text-xs rounded px-3 py-1.5 transition-colors cursor-pointer
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

      {/* Session list */}
      <div className="flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: 'calc(100% - 100px)' }}>
        {sessions.length === 0 && (
          <p className="text-zinc-700 text-xs text-center py-6">Добавь номер телефона и нажми Подключить.</p>
        )}
        {sessions.map((s, index) => {
          const isSelected = selectedPhone === s.phone
          const st = getSessionStats(s)
          const risk = calcBanRisk(s, campaigns)
          return (
          <div
            key={s.phone}
            onClick={() => onSelect(s.phone)}
            className={`rounded-lg border px-3 py-2.5 transition-all cursor-pointer ${
              isSelected
                ? 'border-green-400/60 bg-green-950/15 ring-1 ring-green-400/20'
                : `${STATUS_BORDER[s.status] || 'border-zinc-700'} ${STATUS_BG[s.status] || 'bg-zinc-900'} hover:border-zinc-600`
            }`}
          >
            {/* Top row: number badge + phone + port + delete */}
            <div className="flex items-center gap-2">
              {/* Session number */}
              <span className={`text-[10px] font-bold rounded w-5 h-5 flex items-center justify-center shrink-0 ${
                s.status === 'online'
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                  : s.status === 'banned'
                    ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                    : 'bg-zinc-800 text-zinc-500 border border-zinc-700'
              }`}>
                {index + 1}
              </span>

              {/* Status dot */}
              <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[s.status] || 'bg-zinc-600'}`} />

              {/* Phone number */}
              <span className="text-xs text-zinc-200 font-bold flex-1 min-w-0 truncate">{s.phone}</span>

              {/* Port badge */}
              {s.proxyPort && (
                <span className="text-[10px] text-zinc-600 bg-zinc-800/80 rounded px-1.5 py-0.5 shrink-0 font-mono">
                  :{s.proxyPort}
                </span>
              )}

              {/* Ban-risk badge */}
              <div className="relative shrink-0">
                <button
                  onClick={(e) => { e.stopPropagation(); setRiskTooltip(riskTooltip === s.phone ? null : s.phone) }}
                  className={`text-[9px] font-bold border rounded px-1.5 py-0.5 cursor-pointer transition-colors ${RISK_STYLE[risk.level]}`}
                  title="Риск бана — нажми для деталей"
                >
                  {RISK_ICON[risk.level]} {risk.label}
                </button>
                {riskTooltip === s.phone && (
                  <div
                    className="absolute right-0 top-6 z-50 bg-[#161b22] border border-[#30363d] rounded-lg p-2.5 shadow-xl min-w-[200px]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] text-[#7d8590] uppercase tracking-wider font-bold">⚡ AI Анализ риска</span>
                      <span className={`text-[10px] font-bold ${RISK_STYLE[risk.level].split(' ')[0]}`}>
                        {risk.score}/100
                      </span>
                    </div>
                    {/* Score bar */}
                    <div className="h-1.5 bg-[#21262d] rounded-full mb-2 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          risk.level === 'high' || risk.level === 'banned' ? 'bg-red-500' :
                          risk.level === 'medium' ? 'bg-yellow-500' : 'bg-green-500'
                        }`}
                        style={{ width: `${risk.score}%` }}
                      />
                    </div>
                    {/* Reasons */}
                    <div className="flex flex-col gap-1">
                      {risk.reasons.length === 0
                        ? <span className="text-[10px] text-[#7d8590]">✓ Факторов риска не обнаружено</span>
                        : risk.reasons.map((r, i) => (
                            <span key={i} className="text-[10px] text-[#e6edf3] flex items-start gap-1">
                              <span className={risk.level === 'high' || risk.level === 'banned' ? 'text-red-400' : 'text-yellow-400'}>•</span>
                              {r}
                            </span>
                          ))
                      }
                    </div>
                    <button
                      onClick={() => setRiskTooltip(null)}
                      className="mt-2 text-[9px] text-[#484f58] hover:text-[#7d8590] cursor-pointer w-full text-right"
                    >
                      закрыть ✕
                    </button>
                  </div>
                )}
              </div>

              {/* Delete — two-click confirm */}
              <button
                onClick={(e) => { e.stopPropagation(); removeSession(s.phone) }}
                className={`text-[10px] border rounded px-1.5 py-0.5 transition-colors cursor-pointer shrink-0 ${
                  deleteConfirm === s.phone
                    ? 'text-red-400 border-red-600 bg-red-950/40 font-bold'
                    : 'text-zinc-700 border-zinc-800 hover:text-red-400 hover:border-red-800/50'
                }`}
              >
                {deleteConfirm === s.phone ? 'точно?' : '✕'}
              </button>
            </div>

            {/* Middle row: status label + action buttons */}
            <div className="flex items-center gap-2 mt-1.5 pl-7">
              <span className={`text-[10px] font-bold uppercase tracking-wider ${STATUS_LABEL_COLOR[s.status] || 'text-zinc-500'}`}>
                {STATUS_LABELS[s.status]}
              </span>

              {/* Uptime */}
              {s.status === 'online' && s.connectedAt && (
                <span className="text-[10px] text-zinc-600 font-mono">
                  ⏱ {formatUptime(s.connectedAt)}
                </span>
              )}

              <div className="flex-1" />

              {/* Connect button — shown when offline */}
              {s.status === 'offline' && (
                <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  {/* Mode toggle */}
                  <div className="flex rounded overflow-hidden border border-zinc-700 text-[9px] font-bold">
                    <button
                      onClick={() => setConnectMode(prev => ({ ...prev, [s.phone]: 'qr' }))}
                      className={`px-1.5 py-0.5 transition-colors cursor-pointer ${
                        (connectMode[s.phone] ?? 'qr') === 'qr'
                          ? 'bg-yellow-900/50 text-yellow-400'
                          : 'bg-zinc-900 text-zinc-600 hover:text-zinc-400'
                      }`}
                    >QR</button>
                    <button
                      onClick={() => setConnectMode(prev => ({ ...prev, [s.phone]: 'code' }))}
                      className={`px-1.5 py-0.5 transition-colors cursor-pointer ${
                        connectMode[s.phone] === 'code'
                          ? 'bg-purple-900/50 text-purple-400'
                          : 'bg-zinc-900 text-zinc-600 hover:text-zinc-400'
                      }`}
                    >📱</button>
                  </div>
                  {/* QR mode */}
                  {(connectMode[s.phone] ?? 'qr') === 'qr' && (
                    <button
                      onClick={() => connectSession(s.phone)}
                      disabled={connecting === s.phone}
                      className="text-green-400 text-[10px] border border-green-700/50 bg-green-950/30 rounded px-2.5 py-1
                                 hover:bg-green-900/40 transition-colors cursor-pointer disabled:opacity-50
                                 disabled:cursor-not-allowed font-bold"
                    >
                      {connecting === s.phone ? '...' : '▶ QR'}
                    </button>
                  )}
                  {/* Phone code mode */}
                  {connectMode[s.phone] === 'code' && (
                    <button
                      onClick={() => requestPairingCode(s.phone)}
                      disabled={requestingCode === s.phone}
                      className="text-purple-400 text-[10px] border border-purple-700/50 bg-purple-950/30 rounded px-2.5 py-1
                                 hover:bg-purple-900/40 transition-colors cursor-pointer disabled:opacity-50
                                 disabled:cursor-not-allowed font-bold"
                    >
                      {requestingCode === s.phone ? '...' : '📱 Код'}
                    </button>
                  )}
                </div>
              )}

              {/* QR button — show when QR available (initializing or qr_pending) */}
              {(s.status === 'initializing' || s.status === 'qr_pending') && s.qrCode && (
                <button
                  onClick={(e) => { e.stopPropagation(); setQrModal(s.qrCode!) }}
                  className="text-yellow-400 text-[10px] border border-yellow-600/50 bg-yellow-950/30 rounded px-3 py-1
                             hover:bg-yellow-900/40 transition-colors cursor-pointer font-bold animate-pulse"
                >
                  📷 Показать QR
                </button>
              )}

              {/* Pairing code display — shown when pairing_pending or code just arrived */}
              {(s.status === 'pairing_pending' || pairingCodes[s.phone]) && pairingCodes[s.phone] && (
                <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                  <code className="text-purple-300 font-bold text-sm tracking-[0.2em] bg-purple-950/40 border border-purple-700/60 rounded px-2 py-0.5 animate-pulse font-mono">
                    {pairingCodes[s.phone].replace(/(.{4})(.{4})/, '$1-$2')}
                  </code>
                  <button
                    onClick={() => onPairingCodeUsed?.(s.phone)}
                    className="text-[9px] text-zinc-500 hover:text-zinc-300 cursor-pointer"
                    title="Скрыть"
                  >✕</button>
                </div>
              )}

              {/* Reconnect — shown when initializing/qr_pending but no QR yet, or as secondary action */}
              {(s.status === 'initializing' || s.status === 'qr_pending') && !s.qrCode && (
                <button
                  onClick={(e) => { e.stopPropagation(); reconnectAndShowQR(s.phone) }}
                  disabled={connecting === s.phone}
                  className="text-blue-400 text-[10px] border border-blue-700/50 bg-blue-950/30 rounded px-3 py-1
                             hover:bg-blue-900/40 transition-colors cursor-pointer disabled:opacity-50
                             disabled:cursor-not-allowed font-bold animate-pulse"
                >
                  {connecting === s.phone ? '...' : '⟳ Переподключить'}
                </button>
              )}

              {/* Online indicator */}
              {s.status === 'online' && (
                <span className="text-green-400 text-[10px] font-bold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  Активен
                </span>
              )}
            </div>

            {/* Pairing code instructions */}
            {(s.status === 'pairing_pending' || pairingCodes[s.phone]) && pairingCodes[s.phone] && (
              <p className="text-[9px] text-purple-400/70 pl-7 mt-1">
                WhatsApp → Привязанные устройства → Вход по номеру телефона → введи код
              </p>
            )}

            {/* Bottom row: mini-stats — only for online sessions or sessions with campaigns */}
            {(s.status === 'online' || st.count > 0) && (
              <div className="flex items-center gap-3 mt-2 pl-7">
                <span className="text-[10px] text-zinc-600">
                  <span className="text-zinc-500">{st.count}</span> камп.
                  {st.active > 0 && <span className="text-green-400 ml-0.5">({st.active} ▶)</span>}
                </span>
                <span className="text-[10px] text-zinc-600">
                  <span className="text-green-400 font-bold">{st.sent}</span> отпр.
                </span>
                {st.errors > 0 && (
                  <span className="text-[10px] text-zinc-600">
                    <span className="text-red-400 font-bold">{st.errors}</span> ошиб.
                  </span>
                )}
                {st.leads > 0 && (
                  <span className="text-[10px] text-zinc-600">
                    <span className="text-zinc-500">{st.leads}</span> лидов
                  </span>
                )}
              </div>
            )}
          </div>
          )
        })}
      </div>

      {/* QR Modal */}
      {qrModal && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm cursor-pointer"
          onClick={() => setQrModal(null)}
        >
          <div
            className="bg-zinc-900 border border-zinc-700 rounded-lg p-6 flex flex-col items-center gap-4 shadow-2xl relative"
            onClick={e => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setQrModal(null)}
              className="absolute top-2 right-2 text-zinc-500 hover:text-white text-lg w-8 h-8 flex items-center justify-center
                         rounded-full hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              ✕
            </button>
            <p className="text-green-400 font-bold text-sm tracking-widest uppercase">Сканируй в WhatsApp → Привязанные устройства</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrModal} alt="QR" className="w-64 h-64 rounded bg-white p-2" />
            <button
              onClick={() => setQrModal(null)}
              className="text-zinc-400 hover:text-white text-xs border border-zinc-700 rounded px-4 py-1.5
                         hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              Закрыть
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
