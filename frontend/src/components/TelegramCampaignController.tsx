'use client'
import { useState, useEffect } from 'react'
import { api, type TelegramAccount, type TelegramCampaign } from '@/lib/api'
import { previewSpintax } from '@/lib/spintax'

interface Props {
  accounts: TelegramAccount[]
  selectedAccountId: string | null
  onStatsRefresh: () => void
}

/** Format remaining time */
function formatETA(seconds: number): string {
  if (seconds <= 0 || !isFinite(seconds)) return '—'
  if (seconds < 60) return `~${Math.ceil(seconds)}с`
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `~${mins}м`
  const hours = Math.floor(mins / 60)
  const remMins = mins % 60
  return `~${hours}ч ${remMins}м`
}

export default function TelegramCampaignController({ accounts, selectedAccountId, onStatsRefresh }: Props) {
  const [campaigns, setCampaigns]       = useState<TelegramCampaign[]>([])
  const [selected, setSelected]         = useState<TelegramCampaign | null>(null)
  const [name, setName]                 = useState('')
  const [template, setTemplate]         = useState('')
  const [delayMin, setDelayMin]         = useState(3)
  const [delayMax, setDelayMax]         = useState(8)
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState<string | null>(null)
  const [preview, setPreview]           = useState('')
  const [manualChatIds, setManualChatIds] = useState('')
  const [addingLeads, setAddingLeads]   = useState(false)
  const [addedCount, setAddedCount]     = useState<number | null>(null)

  const selectedAccount = accounts.find(a => a.id === selectedAccountId) || null

  useEffect(() => { loadCampaigns() }, [])
  useEffect(() => { setPreview(previewSpintax(template)) }, [template])

  // Reset campaign selection when account changes
  useEffect(() => { setSelected(null) }, [selectedAccountId])

  async function loadCampaigns() {
    try {
      setCampaigns(await api.telegram.campaigns.list())
    } catch (_) {}
  }

  // Filter campaigns for selected account
  const filteredCampaigns = selectedAccount
    ? campaigns.filter(c => c.account_id === selectedAccount.id || !c.account_id)
    : campaigns

  async function createCampaign() {
    if (!name || !template || !selectedAccount) return
    setLoading(true); setError(null)
    try {
      const c = await api.telegram.campaigns.create({
        name,
        template_text: template,
        account_id: selectedAccount.id,
        delay_min_sec: delayMin,
        delay_max_sec: delayMax,
      })
      setCampaigns(prev => [c, ...prev])
      setSelected(c)
      setName('')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка создания')
    } finally {
      setLoading(false)
    }
  }

  async function addManualLeads() {
    if (!selected || !manualChatIds.trim()) return
    setAddingLeads(true); setAddedCount(null); setError(null)
    try {
      const chatIds = manualChatIds
        .split(/[\n,;]+/)
        .map(p => p.trim())
        .filter(p => p.length > 0)
      const res = await api.telegram.leads.add(selected.id, chatIds)
      setAddedCount(res.imported)
      setManualChatIds('')
      onStatsRefresh()
      await loadCampaigns()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка добавления')
    } finally {
      setAddingLeads(false)
    }
  }

  async function control(action: 'start' | 'pause' | 'stop') {
    if (!selected) return
    setError(null)
    try {
      await api.telegram.campaigns[action](selected.id)
      await loadCampaigns()
      onStatsRefresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка действия')
    }
  }

  // Re-select the updated campaign after reload
  useEffect(() => {
    if (selected) {
      const updated = campaigns.find(c => c.id === selected.id)
      if (updated) setSelected(updated)
    }
  }, [campaigns]) // eslint-disable-line react-hooks/exhaustive-deps

  // No account selected — placeholder
  if (!selectedAccount) {
    return (
      <section className="flex flex-col gap-3 items-center justify-center h-full">
        <span className="text-zinc-700 text-xs text-center py-12">
          ← Выбери аккаунт слева для управления кампаниями
        </span>
      </section>
    )
  }

  // Calculate progress
  const progress = selected ? {
    total: selected.total_leads || 0,
    sent: selected.total_sent || 0,
    errors: selected.total_errors || 0,
    processed: (selected.total_sent || 0) + (selected.total_errors || 0),
    pct: (selected.total_leads || 0) > 0
      ? Math.min(100, Math.round((((selected.total_sent || 0) + (selected.total_errors || 0)) / (selected.total_leads || 1)) * 100))
      : 0,
    avgDelay: (selected.delay_min_sec + selected.delay_max_sec) / 2,
    get speedPerHour() { return this.avgDelay > 0 ? Math.round(3600 / this.avgDelay) : 0 },
    get remaining() { return Math.max(0, this.total - this.processed) },
    get etaSeconds() { return this.remaining * this.avgDelay },
  } : null

  return (
    <section className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-blue-400 font-bold tracking-widest uppercase text-xs">
            ▸ Кампании
          </span>
          <span className="text-zinc-500 text-[10px] bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 font-mono">
            {selectedAccount.username ? `@${selectedAccount.username}` : selectedAccount.phone}
          </span>
        </div>
        <span className="text-zinc-600 text-xs">{filteredCampaigns.length} кампаний</span>
      </div>

      {/* Campaign selector */}
      <div className="flex gap-2">
        <select
          className="flex-1 min-w-0 bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-200
                     focus:outline-none focus:border-blue-500 transition-colors cursor-pointer"
          value={selected?.id || ''}
          onChange={e => {
            const c = filteredCampaigns.find(x => x.id === e.target.value) || null
            setSelected(c)
            if (c) setTemplate(c.template_text)
          }}
        >
          <option value="">-- выбери кампанию --</option>
          {filteredCampaigns.map(c => {
            const pct = (c.total_leads || 0) > 0
              ? Math.round(((c.total_sent + c.total_errors) / (c.total_leads || 1)) * 100)
              : 0
            return (
              <option key={c.id} value={c.id}>
                {c.name} [{c.status}] {(c.total_leads || 0) > 0 ? `${pct}%` : ''}
              </option>
            )
          })}
        </select>
      </div>

      {/* Progress bar */}
      {selected && progress && progress.total > 0 && (
        <div className="flex flex-col gap-1.5 bg-zinc-950 border border-zinc-800 rounded-lg p-3">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  selected.status === 'running'
                    ? 'bg-blue-500'
                    : selected.status === 'paused'
                      ? 'bg-yellow-500'
                      : 'bg-zinc-600'
                }`}
                style={{ width: `${progress.pct}%` }}
              />
            </div>
            <span className="text-[11px] font-bold tabular-nums min-w-[36px] text-right text-zinc-300">
              {progress.pct}%
            </span>
          </div>

          <div className="flex items-center justify-between text-[10px]">
            <div className="flex items-center gap-3">
              <span className="text-zinc-500">
                <span className="text-blue-400 font-bold">{progress.sent}</span>/{progress.total} отправлено
              </span>
              {progress.errors > 0 && (
                <span className="text-zinc-500">
                  <span className="text-red-400 font-bold">{progress.errors}</span> ошибок
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-zinc-600">
                ~{progress.speedPerHour} сообщ/ч
              </span>
              {progress.remaining > 0 && selected.status === 'running' && (
                <span className="text-zinc-500">
                  ETA: <span className="text-zinc-400 font-bold">{formatETA(progress.etaSeconds)}</span>
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* New campaign */}
      <div className="flex gap-2">
        <input
          className="flex-1 min-w-0 bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-200
                     placeholder-zinc-600 focus:outline-none focus:border-blue-500 transition-colors"
          placeholder="Название новой кампании"
          value={name}
          onChange={e => setName(e.target.value)}
        />
      </div>

      {/* Delays */}
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-zinc-600 text-[10px] uppercase tracking-wider">Мин. задержка (с)</label>
          <input
            type="number" min={1} max={3600}
            className="w-full bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 text-xs
                       text-zinc-200 focus:outline-none focus:border-blue-500 transition-colors"
            value={delayMin}
            onChange={e => setDelayMin(Number(e.target.value))}
          />
        </div>
        <div className="flex-1">
          <label className="text-zinc-600 text-[10px] uppercase tracking-wider">Макс. задержка (с)</label>
          <input
            type="number" min={1} max={7200}
            className="w-full bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 text-xs
                       text-zinc-200 focus:outline-none focus:border-blue-500 transition-colors"
            value={delayMax}
            onChange={e => setDelayMax(Number(e.target.value))}
          />
        </div>
        <div className="flex items-end">
          <button
            onClick={createCampaign}
            disabled={loading || !name || !template}
            className="bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-800/50 disabled:text-zinc-700
                       text-zinc-200 text-xs rounded px-3 py-1.5 transition-colors cursor-pointer
                       disabled:cursor-not-allowed whitespace-nowrap border border-zinc-700
                       disabled:border-zinc-800"
          >
            {loading ? '...' : '+ Создать'}
          </button>
        </div>
      </div>

      {/* Template editor */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-zinc-600 text-[10px] uppercase tracking-wider">Шаблон (Spintax)</label>
          <span className="text-zinc-700 text-[10px]">{template.length} символов</span>
        </div>
        <textarea
          rows={3}
          className="bg-zinc-950 border border-zinc-700 rounded px-2.5 py-2 text-xs text-zinc-200
                     placeholder-zinc-600 focus:outline-none focus:border-blue-500 transition-colors
                     resize-none leading-relaxed"
          placeholder={`{Привет|Здравствуйте|Добрый день}! Увидел ваш профиль...\nОсобое предложение для вас.`}
          value={template}
          onChange={e => setTemplate(e.target.value)}
        />
        {preview && (
          <p className="text-[10px] text-zinc-600 truncate">
            <span className="text-zinc-700">Превью: </span>{preview}
          </p>
        )}
      </div>

      {/* Controls — when campaign selected */}
      {selected && (
        <div className="flex flex-col gap-2">
          {/* Manual lead entry */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <label className="text-zinc-600 text-[10px] uppercase tracking-wider">Добавить Chat ID / @username вручную</label>
              {addedCount !== null && (
                <span className="text-blue-400 text-[10px] font-bold">+{addedCount} добавлено</span>
              )}
            </div>
            <div className="flex gap-2">
              <textarea
                rows={2}
                className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-200
                           placeholder-zinc-600 focus:outline-none focus:border-blue-500 transition-colors resize-none"
                placeholder={"Chat ID или @username через запятую:\n123456789, @username1, 987654321"}
                value={manualChatIds}
                onChange={e => setManualChatIds(e.target.value)}
              />
              <button
                onClick={addManualLeads}
                disabled={addingLeads || !manualChatIds.trim()}
                className="bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-800/50 disabled:text-zinc-700
                           text-zinc-200 text-xs rounded px-3 py-1.5 transition-colors cursor-pointer
                           disabled:cursor-not-allowed whitespace-nowrap border border-zinc-700
                           disabled:border-zinc-800 self-end"
              >
                {addingLeads ? '...' : '+ Лиды'}
              </button>
            </div>
          </div>

          {/* Control buttons */}
          <div className="grid grid-cols-3 gap-1.5">
            <button
              onClick={() => control('start')}
              disabled={selected.status === 'running'}
              className="bg-blue-700 hover:bg-blue-600 disabled:bg-zinc-800 disabled:text-zinc-600
                         text-white font-bold text-xs rounded py-2 transition-colors cursor-pointer
                         disabled:cursor-not-allowed"
            >
              ▶ СТАРТ
            </button>
            <button
              onClick={() => control('pause')}
              disabled={selected.status !== 'running'}
              className="bg-yellow-700 hover:bg-yellow-600 disabled:bg-zinc-800 disabled:text-zinc-600
                         text-black font-bold text-xs rounded py-2 transition-colors cursor-pointer
                         disabled:cursor-not-allowed"
            >
              ⏸ ПАУЗА
            </button>
            <button
              onClick={() => control('stop')}
              disabled={selected.status === 'stopped' || selected.status === 'draft' || (selected.status !== 'running' && selected.status !== 'paused')}
              className="bg-red-800 hover:bg-red-700 disabled:bg-zinc-800 disabled:text-zinc-600
                         text-zinc-100 font-bold text-xs rounded py-2 transition-colors cursor-pointer
                         disabled:cursor-not-allowed"
            >
              ⏹ СТОП
            </button>
          </div>

          {/* Campaign stats */}
          <div className="grid grid-cols-3 gap-1.5 text-center">
            <div className="bg-zinc-950 rounded py-1.5 px-2">
              <p className="text-blue-400 text-sm font-bold">{selected.total_sent}</p>
              <p className="text-zinc-700 text-[10px]">Отправлено</p>
            </div>
            <div className="bg-zinc-950 rounded py-1.5 px-2">
              <p className={`text-sm font-bold ${
                selected.status === 'running' ? 'text-blue-400' :
                selected.status === 'paused' ? 'text-yellow-400' : 'text-zinc-600'
              }`}>
                {selected.status === 'running' ? '▶' : selected.status === 'paused' ? '⏸' : '⏹'}
              </p>
              <p className="text-zinc-700 text-[10px]">
                {selected.status === 'running' ? 'Работает' : selected.status === 'paused' ? 'Пауза' : 'Остановлено'}
              </p>
            </div>
            <div className="bg-zinc-950 rounded py-1.5 px-2">
              <p className="text-red-400 text-sm font-bold">{selected.total_errors}</p>
              <p className="text-zinc-700 text-[10px]">Ошибки</p>
            </div>
          </div>
        </div>
      )}

      {error && (
        <p className="text-red-400 text-xs border border-red-900/50 rounded px-2 py-1 bg-red-950/20">
          ✗ {error}
        </p>
      )}
    </section>
  )
}
