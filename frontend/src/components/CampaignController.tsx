'use client'
import { useState, useEffect } from 'react'
import { api, type Campaign, type Session } from '@/lib/api'
import { previewSpintax } from '@/lib/spintax'

interface Props {
  sessions: Session[]
  selectedPhone: string | null
  onStatsRefresh: () => void
}

/** Format remaining time in human-readable */
function formatETA(seconds: number): string {
  if (seconds <= 0 || !isFinite(seconds)) return '—'
  if (seconds < 60) return `~${Math.ceil(seconds)}с`
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `~${mins}м`
  const hours = Math.floor(mins / 60)
  const remMins = mins % 60
  return `~${hours}ч ${remMins}м`
}

export default function CampaignController({ sessions, selectedPhone, onStatsRefresh }: Props) {
  const [campaigns, setCampaigns]       = useState<Campaign[]>([])
  const [selected, setSelected]         = useState<Campaign | null>(null)
  const [name, setName]                 = useState('')
  const [template, setTemplate]         = useState('')
  const [delayMin, setDelayMin]         = useState(240)
  const [delayMax, setDelayMax]         = useState(540)
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState<string | null>(null)
  const [importing, setImporting]       = useState(false)
  const [importCount, setImportCount]   = useState<number | null>(null)
  const [preview, setPreview]           = useState('')
  const [manualPhones, setManualPhones] = useState('')
  const [addingLeads, setAddingLeads]   = useState(false)
  const [addedCount, setAddedCount]     = useState<number | null>(null)
  const [aiCriteria, setAiCriteria]     = useState('')

  // Find the selected session object (for UUID)
  const selectedSession = sessions.find(s => s.phone === selectedPhone) || null

  useEffect(() => { loadCampaigns() }, [])
  useEffect(() => { setPreview(previewSpintax(template)) }, [template])

  // When selected session changes, reset campaign selection
  useEffect(() => {
    setSelected(null)
  }, [selectedPhone])

  async function loadCampaigns() {
    try {
      setCampaigns(await api.campaigns.list())
    } catch (_) {}
  }

  // Filter campaigns for the selected session
  const filteredCampaigns = selectedSession
    ? campaigns.filter(c => c.session_id === selectedSession.id || !c.session_id)
    : campaigns

  async function createCampaign() {
    if (!name || !template || !selectedSession) return
    setLoading(true); setError(null)
    try {
      const c = await api.campaigns.create({
        name, template_text: template,
        session_id: selectedSession.id,
        delay_min_sec: delayMin,
        delay_max_sec: delayMax,
        ...(aiCriteria ? { ai_criteria: aiCriteria } : {}),
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

  async function importLeads() {
    if (!selected) return
    setImporting(true); setImportCount(null); setError(null)
    try {
      const res = await api.leads.import(selected.id)
      setImportCount(res.imported)
      onStatsRefresh()
      // Reload campaigns to get updated total_leads
      await loadCampaigns()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка импорта')
    } finally {
      setImporting(false)
    }
  }

  async function addManualLeads() {
    if (!selected || !manualPhones.trim()) return
    setAddingLeads(true); setAddedCount(null); setError(null)
    try {
      const phones = manualPhones
        .split(/[\n,;]+/)
        .map(p => p.trim())
        .filter(p => p.length > 5)
      const res = await api.leads.add(selected.id, phones)
      setAddedCount(res.imported)
      setManualPhones('')
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
      await api.campaigns[action](selected.id)
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

  // ── No session selected — placeholder ──────────────────────────────────────
  if (!selectedSession) {
    return (
      <section className="flex flex-col gap-3 items-center justify-center h-full">
        <span className="text-[#484f58] text-xs text-center py-12">
          ← Выбери сессию слева для управления кампаниями
        </span>
      </section>
    )
  }

  // ── Calculate campaign progress ────────────────────────────────────────────
  const progress = selected ? {
    total: selected.total_leads || 0,
    sent: selected.total_sent || 0,
    errors: selected.total_errors || 0,
    processed: (selected.total_sent || 0) + (selected.total_errors || 0),
    pct: selected.total_leads > 0
      ? Math.min(100, Math.round(((selected.total_sent + selected.total_errors) / selected.total_leads) * 100))
      : 0,
    // Speed: estimate messages/hour based on avg delay
    avgDelay: (selected.delay_min_sec + selected.delay_max_sec) / 2,
    get speedPerHour() { return this.avgDelay > 0 ? Math.round(3600 / this.avgDelay) : 0 },
    get remaining() { return Math.max(0, this.total - this.processed) },
    get etaSeconds() { return this.remaining * this.avgDelay },
  } : null

  return (
    <section className="flex flex-col gap-3">
      {/* Header — shows which session's campaigns we're viewing */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-green-400 font-bold tracking-widest uppercase text-xs">
            ▸ Кампании
          </span>
          <span className="text-[#7d8590] text-[10px] bg-[#21262d] border border-[#30363d] rounded px-1.5 py-0.5 font-mono">
            {selectedPhone}
          </span>
        </div>
        <span className="text-[#7d8590] text-xs">{filteredCampaigns.length} кампаний</span>
      </div>

      {/* Campaign selector */}
      <div className="flex flex-col gap-1">
        <select
          className="flex-1 min-w-0 bg-[#0d1117] border border-[#30363d] rounded px-2.5 py-1.5 text-xs text-[#e6edf3]
                     focus:outline-none focus:border-green-500 transition-colors cursor-pointer"
          value={selected?.id || ''}
          onChange={e => {
            const c = filteredCampaigns.find(x => x.id === e.target.value) || null
            setSelected(c)
            if (c) {
              setTemplate(c.template_text)
              setAiCriteria(c.ai_criteria || '')
            }
          }}
        >
          <option value="">-- выбери кампанию --</option>
          {filteredCampaigns.map(c => {
            const pct = c.total_leads > 0 ? Math.round(((c.total_sent + c.total_errors) / c.total_leads) * 100) : 0
            return (
              <option key={c.id} value={c.id}>
                {c.name} [{c.status}] {c.total_leads > 0 ? `${pct}%` : ''}
              </option>
            )
          })}
        </select>
        {filteredCampaigns.length === 0 && (
          <p className="text-[10px] text-amber-500/80">↓ Создай первую кампанию ниже — заполни название, шаблон и нажми «Создать»</p>
        )}
      </div>

      {/* ── Progress bar — when campaign is selected and has leads ── */}
      {selected && progress && progress.total > 0 && (
        <div className="flex flex-col gap-1.5 bg-[#0d1117] border border-[#30363d] rounded-lg p-3">
          {/* Progress bar */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2.5 bg-[#21262d] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  selected.status === 'running'
                    ? 'bg-green-500'
                    : selected.status === 'paused'
                      ? 'bg-yellow-500'
                      : 'bg-zinc-600'
                }`}
                style={{ width: `${progress.pct}%` }}
              />
            </div>
            <span className="text-[11px] font-bold tabular-nums min-w-[36px] text-right text-[#e6edf3]">
              {progress.pct}%
            </span>
          </div>

          {/* Stats row */}
          <div className="flex items-center justify-between text-[10px]">
            <div className="flex items-center gap-3">
              <span className="text-[#7d8590]">
                <span className="text-green-400 font-bold">{progress.sent}</span>/{progress.total} отправлено
              </span>
              {progress.errors > 0 && (
                <span className="text-[#7d8590]">
                  <span className="text-red-400 font-bold">{progress.errors}</span> ошибок
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[#7d8590]">
                ~{progress.speedPerHour} сообщ/ч
              </span>
              {progress.remaining > 0 && selected.status === 'running' && (
                <span className="text-[#7d8590]">
                  ETA: <span className="text-zinc-400 font-bold">{formatETA(progress.etaSeconds)}</span>
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* New campaign — name + delays */}
      <div className="flex gap-2">
        <input
          className="flex-1 min-w-0 bg-[#0d1117] border border-[#30363d] rounded px-2.5 py-1.5 text-xs text-[#e6edf3]
                     placeholder-zinc-600 focus:outline-none focus:border-green-500 transition-colors"
          placeholder="Название новой кампании"
          value={name}
          onChange={e => setName(e.target.value)}
        />
      </div>

      {/* Delays row */}
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-[#7d8590] text-[10px] uppercase tracking-wider">Мин. задержка (с)</label>
          <input
            type="number" min={60} max={3600}
            className="w-full bg-[#0d1117] border border-[#30363d] rounded px-2.5 py-1.5 text-xs
                       text-[#e6edf3] focus:outline-none focus:border-green-500 transition-colors"
            value={delayMin}
            onChange={e => setDelayMin(Number(e.target.value))}
          />
        </div>
        <div className="flex-1">
          <label className="text-[#7d8590] text-[10px] uppercase tracking-wider">Макс. задержка (с)</label>
          <input
            type="number" min={60} max={7200}
            className="w-full bg-[#0d1117] border border-[#30363d] rounded px-2.5 py-1.5 text-xs
                       text-[#e6edf3] focus:outline-none focus:border-green-500 transition-colors"
            value={delayMax}
            onChange={e => setDelayMax(Number(e.target.value))}
          />
        </div>
      </div>

      {/* Template editor */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-[#7d8590] text-[10px] uppercase tracking-wider">Шаблон (Spintax)</label>
          <span className="text-[#484f58] text-[10px]">{template.length} символов</span>
        </div>
        <textarea
          rows={3}
          className="bg-[#0d1117] border border-[#30363d] rounded px-2.5 py-2 text-xs text-[#e6edf3]
                     placeholder-zinc-600 focus:outline-none focus:border-green-500 transition-colors
                     resize-none leading-relaxed"
          placeholder={`{Привет|Здравствуйте|Добрый день}! Увидел ваш профиль...\nЭксклюзивное размещение доступно.`}
          value={template}
          onChange={e => setTemplate(e.target.value)}
        />
        {preview && (
          <p className="text-[10px] text-[#7d8590] truncate">
            <span className="text-[#484f58]">Превью: </span>{preview}
          </p>
        )}
      </div>

      {/* AI Lead Detector criteria */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <label className="text-[#7d8590] text-[10px] uppercase tracking-wider">
            ИИ-Детектор лидов
          </label>
          <span className="text-purple-500 text-[10px]">GPT-4o-mini</span>
        </div>
        <textarea
          rows={2}
          className="bg-[#0d1117] border border-[#30363d] rounded px-2.5 py-2 text-xs text-[#e6edf3]
                     placeholder-zinc-600 focus:outline-none focus:border-purple-500 transition-colors
                     resize-none leading-relaxed"
          placeholder="Опишите, что вы ожидаете от лидов: &quot;Ищем людей, заинтересованных в покупке недвижимости в Дубае, бюджет от $200к&quot;"
          value={aiCriteria}
          onChange={e => setAiCriteria(e.target.value)}
        />
        {selected && aiCriteria !== (selected.ai_criteria || '') && (
          <button
            onClick={async () => {
              try {
                await api.campaigns.update(selected.id, { ai_criteria: aiCriteria || null })
                loadCampaigns()
              } catch (_) {}
            }}
            className="self-start text-[10px] text-purple-400 hover:text-purple-300 cursor-pointer
                       bg-purple-950/30 border border-purple-900/50 rounded px-2 py-0.5"
          >
            Сохранить критерии AI
          </button>
        )}
      </div>

      {/* Create campaign button — shown only when not editing an existing one */}
      {!selected && (
        <button
          onClick={createCampaign}
          disabled={loading || !name || !template}
          className="w-full bg-green-700 hover:bg-green-600 disabled:bg-[#21262d] disabled:text-[#484f58]
                     text-black font-bold text-xs rounded px-3 py-2 transition-colors cursor-pointer
                     disabled:cursor-not-allowed border border-green-600 disabled:border-[#30363d]"
          title={!name ? 'Введите название' : !template ? 'Введите шаблон сообщения' : ''}
        >
          {loading ? '...' : '+ Создать кампанию'}
        </button>
      )}

      {/* Controls — only when campaign selected */}
      {selected && (
        <div className="flex flex-col gap-2">
          {/* Import + manual leads */}
          <div className="flex gap-2 items-center">
            <button
              onClick={importLeads}
              disabled={importing}
              className="flex-1 bg-[#21262d] hover:bg-zinc-700 disabled:opacity-50 text-[#e6edf3]
                         text-xs rounded px-3 py-1.5 transition-colors cursor-pointer border border-[#30363d]"
            >
              {importing ? 'Импорт...' : '⤓ Импорт из Tahles'}
            </button>
            {importCount !== null && (
              <span className="text-green-400 text-xs font-bold">+{importCount}</span>
            )}
          </div>

          {/* Manual lead entry */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <label className="text-[#7d8590] text-[10px] uppercase tracking-wider">Добавить номера вручную</label>
              {addedCount !== null && (
                <span className="text-green-400 text-[10px] font-bold">+{addedCount} добавлено</span>
              )}
            </div>
            <div className="flex gap-2">
              <textarea
                rows={2}
                className="flex-1 bg-[#0d1117] border border-[#30363d] rounded px-2.5 py-1.5 text-xs text-[#e6edf3]
                           placeholder-zinc-600 focus:outline-none focus:border-green-500 transition-colors resize-none"
                placeholder="972501234567, 972509876543&#10;По одному на строку или через запятую"
                value={manualPhones}
                onChange={e => setManualPhones(e.target.value)}
              />
              <button
                onClick={addManualLeads}
                disabled={addingLeads || !manualPhones.trim()}
                className="bg-[#21262d] hover:bg-zinc-700 disabled:bg-[#21262d]/50 disabled:text-[#484f58]
                           text-[#e6edf3] text-xs rounded px-3 py-1.5 transition-colors cursor-pointer
                           disabled:cursor-not-allowed whitespace-nowrap border border-[#30363d]
                           disabled:border-[#30363d] self-end"
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
              className="bg-green-700 hover:bg-green-600 disabled:bg-[#21262d] disabled:text-[#7d8590]
                         text-black font-bold text-xs rounded py-2 transition-colors cursor-pointer
                         disabled:cursor-not-allowed"
            >
              ▶ СТАРТ
            </button>
            <button
              onClick={() => control('pause')}
              disabled={selected.status !== 'running'}
              className="bg-yellow-700 hover:bg-yellow-600 disabled:bg-[#21262d] disabled:text-[#7d8590]
                         text-black font-bold text-xs rounded py-2 transition-colors cursor-pointer
                         disabled:cursor-not-allowed"
            >
              ⏸ ПАУЗА
            </button>
            <button
              onClick={() => control('stop')}
              disabled={selected.status === 'stopped' || selected.status !== 'running' && selected.status !== 'paused'}
              className="bg-red-800 hover:bg-red-700 disabled:bg-[#21262d] disabled:text-[#7d8590]
                         text-zinc-100 font-bold text-xs rounded py-2 transition-colors cursor-pointer
                         disabled:cursor-not-allowed"
            >
              ⏹ СТОП
            </button>
          </div>

          {/* Campaign stats mini row */}
          <div className="grid grid-cols-3 gap-1.5 text-center">
            <div className="bg-[#0d1117] rounded py-1.5 px-2">
              <p className="text-green-400 text-sm font-bold">{selected.total_sent}</p>
              <p className="text-[#484f58] text-[10px]">Отправлено</p>
            </div>
            <div className="bg-[#0d1117] rounded py-1.5 px-2">
              <p className={`text-sm font-bold ${
                selected.status === 'running' ? 'text-green-400' :
                selected.status === 'paused' ? 'text-yellow-400' : 'text-[#7d8590]'
              }`}>
                {selected.status === 'running' ? '▶' : selected.status === 'paused' ? '⏸' : '⏹'}
              </p>
              <p className="text-[#484f58] text-[10px]">
                {selected.status === 'running' ? 'Работает' : selected.status === 'paused' ? 'Пауза' : 'Остановлено'}
              </p>
            </div>
            <div className="bg-[#0d1117] rounded py-1.5 px-2">
              <p className="text-red-400 text-sm font-bold">{selected.total_errors}</p>
              <p className="text-[#484f58] text-[10px]">Ошибки</p>
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
