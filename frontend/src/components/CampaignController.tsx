'use client'
import { useState, useEffect, useRef } from 'react'
import { api, type Campaign, type Session, type Lead } from '@/lib/api'
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

function parsePhonesFromText(content: string): string[] {
  return content
    .split(/[\n\r,;\t]+/)
    .map(p => p.trim().replace(/["']/g, '').replace(/\D/g, ''))
    .filter(p => p.length >= 7 && p.length <= 15)
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
  const [showCreate, setShowCreate]     = useState(false)
  const [aiStats, setAiStats]           = useState<{ hot: number; warm: number; cold: number; irrelevant: number; unscored: number }>({ hot: 0, warm: 0, cold: 0, irrelevant: 0, unscored: 0 })

  // File import state
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileImporting, setFileImporting] = useState(false)
  const [fileResult, setFileResult]       = useState<string | null>(null)

  // Find the selected session object (for UUID)
  const selectedSession = sessions.find(s => s.phone === selectedPhone) || null

  useEffect(() => { loadCampaigns() }, [])
  useEffect(() => { setPreview(previewSpintax(template)) }, [template])

  // When selected session changes, auto-select first campaign
  useEffect(() => {
    setSelected(null)
    setShowCreate(false)
  }, [selectedPhone])

  // Auto-select first campaign if only one exists, or auto-select when campaigns load
  useEffect(() => {
    if (!selected && filteredCampaigns.length === 1) {
      const c = filteredCampaigns[0]
      setSelected(c)
      setTemplate(c.template_text)
      setAiCriteria(c.ai_criteria || '')
    }
  }, [campaigns, selectedPhone]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load AI score stats when campaign changes
  useEffect(() => {
    if (!selected) { setAiStats({ hot: 0, warm: 0, cold: 0, irrelevant: 0, unscored: 0 }); return }
    api.leads.list({ campaign_id: selected.id, limit: 1000 })
      .then(res => {
        const counts = { hot: 0, warm: 0, cold: 0, irrelevant: 0, unscored: 0 }
        for (const l of res.data) {
          if (l.ai_score && l.ai_score in counts) counts[l.ai_score as keyof typeof counts]++
          else counts.unscored++
        }
        setAiStats(counts)
      })
      .catch(() => {})
  }, [selected?.id, selected?.total_sent]) // eslint-disable-line react-hooks/exhaustive-deps

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
      setShowCreate(false)
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

  async function handleFileUpload(file: File) {
    if (!selected) return
    setFileImporting(true); setFileResult(null)
    try {
      const content = await file.text()
      const phones = parsePhonesFromText(content)
      const unique = [...new Set(phones)]
      if (unique.length === 0) {
        setFileResult('✗ Не найдено валидных номеров в файле')
        setFileImporting(false)
        return
      }
      const res = await api.leads.add(selected.id, unique)
      setFileResult(`✓ Загружено ${res.imported} номеров из ${unique.length} (${unique.length - res.imported} дубликатов пропущено)`)
      onStatsRefresh()
      await loadCampaigns()
    } catch (e: unknown) {
      setFileResult(`✗ ${e instanceof Error ? e.message : 'Ошибка импорта'}`)
    } finally {
      setFileImporting(false)
      if (fileRef.current) fileRef.current.value = ''
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
    avgDelay: (selected.delay_min_sec + selected.delay_max_sec) / 2,
    get speedPerHour() { return this.avgDelay > 0 ? Math.round(3600 / this.avgDelay) : 0 },
    get remaining() { return Math.max(0, this.total - this.processed) },
    get etaSeconds() { return this.remaining * this.avgDelay },
  } : null

  // Hidden file input
  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept=".txt,.csv,.tsv"
      className="hidden"
      onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f) }}
    />
  )

  return (
    <section className="flex flex-col gap-3">
      {fileInput}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-green-400 font-bold tracking-widest uppercase text-xs">
            ▸ Кампании
          </span>
          <span className="text-[#7d8590] text-[10px] bg-[#21262d] border border-[#30363d] rounded px-1.5 py-0.5 font-mono">
            {selectedPhone}
          </span>
        </div>
        {/* + New campaign button */}
        {!showCreate && (
          <button
            onClick={() => { setShowCreate(true); setSelected(null) }}
            className="text-[10px] text-green-400 hover:text-green-300 cursor-pointer
                       bg-green-950/30 border border-green-900/50 rounded px-2 py-0.5 font-bold"
          >
            + Новая
          </button>
        )}
      </div>

      {/* ── Campaign cards — visual selection instead of dropdown ── */}
      {filteredCampaigns.length > 0 && !showCreate && (
        <div className="flex flex-col gap-1.5 max-h-[140px] overflow-y-auto">
          {filteredCampaigns.map(c => {
            const isActive = selected?.id === c.id
            const pct = c.total_leads > 0 ? Math.round(((c.total_sent + c.total_errors) / c.total_leads) * 100) : 0
            const statusColor = c.status === 'running' ? 'bg-green-400' : c.status === 'paused' ? 'bg-yellow-400' : 'bg-zinc-600'
            const statusLabel = c.status === 'running' ? '▶' : c.status === 'paused' ? '⏸' : '⏹'
            return (
              <button
                key={c.id}
                onClick={() => {
                  setSelected(c)
                  setTemplate(c.template_text)
                  setAiCriteria(c.ai_criteria || '')
                  setShowCreate(false)
                }}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-all cursor-pointer text-left w-full ${
                  isActive
                    ? 'bg-green-950/30 border-green-700/60 ring-1 ring-green-800/40'
                    : 'bg-[#0d1117] border-[#30363d] hover:border-[#484f58] hover:bg-[#161b22]'
                }`}
              >
                {/* Status dot */}
                <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${statusColor}`} />

                {/* Campaign info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs font-bold truncate ${isActive ? 'text-green-400' : 'text-[#e6edf3]'}`}>
                      {c.name}
                    </span>
                    <span className="text-[9px] text-[#484f58]">{statusLabel}</span>
                  </div>
                  {c.total_leads > 0 && (
                    <div className="flex items-center gap-2 mt-0.5">
                      {/* Mini progress bar */}
                      <div className="flex-1 h-1 bg-[#21262d] rounded-full overflow-hidden max-w-[100px]">
                        <div
                          className={`h-full rounded-full ${c.status === 'running' ? 'bg-green-500' : 'bg-zinc-600'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-[9px] text-[#7d8590] tabular-nums">
                        {c.total_sent}/{c.total_leads}
                      </span>
                    </div>
                  )}
                </div>

                {/* Percent badge */}
                {c.total_leads > 0 && (
                  <span className={`text-[10px] font-bold tabular-nums shrink-0 ${
                    pct === 100 ? 'text-green-400' : 'text-[#7d8590]'
                  }`}>
                    {pct}%
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* No campaigns yet — prompt to create */}
      {filteredCampaigns.length === 0 && !showCreate && (
        <div className="flex flex-col items-center gap-2 py-4">
          <p className="text-[#7d8590] text-xs text-center">Нет кампаний для этой сессии</p>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-green-700 hover:bg-green-600 text-black font-bold text-xs rounded px-4 py-2 transition-colors cursor-pointer
                       border border-green-600"
          >
            + Создать первую кампанию
          </button>
        </div>
      )}

      {/* ── New campaign form ── */}
      {showCreate && (
        <div className="flex flex-col gap-2 bg-[#0d1117] border border-green-900/40 rounded-lg p-3">
          <div className="flex items-center justify-between">
            <span className="text-green-400 text-[10px] uppercase tracking-wider font-bold">Новая кампания</span>
            <button
              onClick={() => { setShowCreate(false); if (filteredCampaigns.length > 0) setSelected(filteredCampaigns[0]) }}
              className="text-[#7d8590] hover:text-[#e6edf3] text-xs cursor-pointer"
            >
              ✕
            </button>
          </div>

          <input
            className="bg-[#161b22] border border-[#30363d] rounded px-2.5 py-1.5 text-xs text-[#e6edf3]
                       placeholder-zinc-600 focus:outline-none focus:border-green-500 transition-colors"
            placeholder="Название кампании"
            value={name}
            onChange={e => setName(e.target.value)}
          />

          {/* Delays row */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[#7d8590] text-[10px] uppercase tracking-wider">Мин. задержка (с)</label>
              <input
                type="number" min={60} max={3600}
                className="w-full bg-[#161b22] border border-[#30363d] rounded px-2.5 py-1.5 text-xs
                           text-[#e6edf3] focus:outline-none focus:border-green-500 transition-colors"
                value={delayMin}
                onChange={e => setDelayMin(Number(e.target.value))}
              />
            </div>
            <div className="flex-1">
              <label className="text-[#7d8590] text-[10px] uppercase tracking-wider">Макс. задержка (с)</label>
              <input
                type="number" min={60} max={7200}
                className="w-full bg-[#161b22] border border-[#30363d] rounded px-2.5 py-1.5 text-xs
                           text-[#e6edf3] focus:outline-none focus:border-green-500 transition-colors"
                value={delayMax}
                onChange={e => setDelayMax(Number(e.target.value))}
              />
            </div>
          </div>

          {/* Template editor */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-[#7d8590] text-[10px] uppercase tracking-wider">Шаблон (Spintax)</label>
              <span className="text-[#484f58] text-[10px]">{template.length} символов</span>
            </div>
            <textarea
              rows={3}
              className="bg-[#161b22] border border-[#30363d] rounded px-2.5 py-2 text-xs text-[#e6edf3]
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

          {/* AI criteria */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <label className="text-[#7d8590] text-[10px] uppercase tracking-wider">ИИ-Детектор</label>
              <span className="text-purple-500 text-[10px]">GPT-4o-mini</span>
            </div>
            <textarea
              rows={2}
              className="bg-[#161b22] border border-[#30363d] rounded px-2.5 py-2 text-xs text-[#e6edf3]
                         placeholder-zinc-600 focus:outline-none focus:border-purple-500 transition-colors
                         resize-none leading-relaxed"
              placeholder="Опишите, что ожидаете от лидов: &quot;Ищем людей, заинтересованных в покупке...&quot;"
              value={aiCriteria}
              onChange={e => setAiCriteria(e.target.value)}
            />
          </div>

          <button
            onClick={createCampaign}
            disabled={loading || !name || !template}
            className="w-full bg-green-700 hover:bg-green-600 disabled:bg-[#21262d] disabled:text-[#484f58]
                       text-black font-bold text-xs rounded px-3 py-2 transition-colors cursor-pointer
                       disabled:cursor-not-allowed border border-green-600 disabled:border-[#30363d]"
          >
            {loading ? '...' : '+ Создать кампанию'}
          </button>
        </div>
      )}

      {/* ── Progress bar — when campaign is selected and has leads ── */}
      {selected && progress && progress.total > 0 && (
        <div className="flex flex-col gap-1.5 bg-[#0d1117] border border-[#30363d] rounded-lg p-3">
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
              <span className="text-[#7d8590]">~{progress.speedPerHour} сообщ/ч</span>
              {progress.remaining > 0 && selected.status === 'running' && (
                <span className="text-[#7d8590]">
                  ETA: <span className="text-zinc-400 font-bold">{formatETA(progress.etaSeconds)}</span>
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Controls — only when campaign selected */}
      {selected && (
        <div className="flex flex-col gap-2">

          {/* ── Import section — .txt file upload + manual + Tahles ── */}
          <div className="bg-[#0d1117] border border-[#30363d] rounded-lg p-2.5">
            <p className="text-blue-400 text-[10px] uppercase tracking-wider font-bold mb-2">
              📋 Импорт базы номеров
            </p>

            {/* File upload + Tahles row */}
            <div className="flex gap-1.5 mb-2">
              <button
                onClick={() => fileRef.current?.click()}
                disabled={fileImporting}
                className="flex-1 bg-blue-700 hover:bg-blue-600 disabled:bg-[#21262d] disabled:text-[#484f58]
                           text-white font-bold text-xs rounded px-3 py-2 transition-colors cursor-pointer
                           disabled:cursor-not-allowed"
              >
                {fileImporting ? 'Загрузка...' : '📂 Загрузить .txt файл'}
              </button>
              <button
                onClick={importLeads}
                disabled={importing}
                className="bg-[#21262d] hover:bg-zinc-700 disabled:opacity-50 text-[#e6edf3]
                           text-xs rounded px-3 py-2 transition-colors cursor-pointer border border-[#30363d]"
              >
                {importing ? '...' : '⤓ Tahles'}
              </button>
              {(importCount !== null) && (
                <span className="text-green-400 text-xs font-bold self-center">+{importCount}</span>
              )}
            </div>

            {/* File result */}
            {fileResult && (
              <p className={`text-[10px] rounded px-2 py-1 mb-2 ${
                fileResult.startsWith('✓')
                  ? 'text-green-400 bg-green-950/20 border border-green-900/50'
                  : 'text-red-400 bg-red-950/20 border border-red-900/50'
              }`}>
                {fileResult}
              </p>
            )}

            {/* Format hint */}
            <p className="text-[#7d8590] text-[9px] mb-2">
              Формат .txt: один номер на строку (972501234567). Также принимает .csv, .tsv
            </p>

            {/* Manual phone entry */}
            <div className="flex gap-1.5">
              <textarea
                rows={2}
                className="flex-1 bg-[#161b22] border border-[#30363d] rounded px-2.5 py-1.5 text-xs text-[#e6edf3]
                           placeholder-zinc-600 focus:outline-none focus:border-blue-500 transition-colors resize-none"
                placeholder={"Или вставь номера:\n972501234567, 972509876543"}
                value={manualPhones}
                onChange={e => setManualPhones(e.target.value)}
              />
              <button
                onClick={addManualLeads}
                disabled={addingLeads || !manualPhones.trim()}
                className="bg-[#21262d] hover:bg-[#30363d] disabled:bg-[#21262d]/50 disabled:text-[#484f58]
                           text-[#e6edf3] text-xs rounded px-3 py-1.5 transition-colors cursor-pointer
                           disabled:cursor-not-allowed whitespace-nowrap border border-[#30363d]
                           disabled:border-[#21262d] self-end"
              >
                {addingLeads ? '...' : '+ Лиды'}
              </button>
            </div>
            {addedCount !== null && (
              <span className="text-green-400 text-[10px] font-bold mt-1">+{addedCount} добавлено</span>
            )}
          </div>

          {/* AI criteria — edit for existing campaign */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <label className="text-[#7d8590] text-[10px] uppercase tracking-wider">ИИ-Детектор</label>
              <span className="text-purple-500 text-[10px]">GPT-4o-mini</span>
            </div>
            <textarea
              rows={2}
              className="bg-[#0d1117] border border-[#30363d] rounded px-2.5 py-2 text-xs text-[#e6edf3]
                         placeholder-zinc-600 focus:outline-none focus:border-purple-500 transition-colors
                         resize-none leading-relaxed"
              placeholder="Опишите, что ожидаете от лидов: &quot;Ищем людей, заинтересованных в покупке...&quot;"
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

          {/* Template editor — for editing selected campaign */}
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
              placeholder={`{Привет|Здравствуйте|Добрый день}! Увидел ваш профиль...`}
              value={template}
              onChange={e => setTemplate(e.target.value)}
            />
            {preview && (
              <p className="text-[10px] text-[#7d8590] truncate">
                <span className="text-[#484f58]">Превью: </span>{preview}
              </p>
            )}
            {selected && template !== selected.template_text && (
              <button
                onClick={async () => {
                  try {
                    await api.campaigns.update(selected.id, { template_text: template })
                    loadCampaigns()
                  } catch (_) {}
                }}
                className="self-start text-[10px] text-green-400 hover:text-green-300 cursor-pointer
                           bg-green-950/30 border border-green-900/50 rounded px-2 py-0.5"
              >
                Сохранить шаблон
              </button>
            )}
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

          {/* AI Lead Scores */}
          {(aiStats.hot > 0 || aiStats.warm > 0 || aiStats.cold > 0 || aiStats.irrelevant > 0) && (
            <div className="bg-[#0d1117] border border-purple-900/40 rounded-lg p-2.5">
              <p className="text-purple-400 text-[10px] uppercase tracking-wider font-bold mb-1.5">
                ИИ-Детектор
              </p>
              <div className="grid grid-cols-4 gap-1.5 text-center">
                <div className="bg-red-950/30 rounded py-1.5 px-1" title="Горячие — полностью соответствуют критериям">
                  <p className="text-red-400 text-sm font-bold">{aiStats.hot}</p>
                  <p className="text-red-400/60 text-[9px]">HOT</p>
                </div>
                <div className="bg-yellow-950/30 rounded py-1.5 px-1" title="Тёплые — частичный интерес">
                  <p className="text-yellow-400 text-sm font-bold">{aiStats.warm}</p>
                  <p className="text-yellow-400/60 text-[9px]">WARM</p>
                </div>
                <div className="bg-blue-950/30 rounded py-1.5 px-1" title="Холодные — минимальный интерес">
                  <p className="text-blue-400 text-sm font-bold">{aiStats.cold}</p>
                  <p className="text-blue-400/60 text-[9px]">COLD</p>
                </div>
                <div className="bg-zinc-800/50 rounded py-1.5 px-1" title="Нерелевантные — отказ, спам">
                  <p className="text-zinc-500 text-sm font-bold">{aiStats.irrelevant}</p>
                  <p className="text-zinc-500/60 text-[9px]">N/A</p>
                </div>
              </div>
            </div>
          )}
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
