'use client'
import { useState, useRef } from 'react'
import { api, type Session, type Campaign } from '@/lib/api'

interface Props {
  sessions: Session[]
  campaigns: Campaign[]
  selectedPhone: string | null
  onStatsRefresh: () => void
}

type Tab = 'send' | 'import'

function parsePhonesFromText(content: string): string[] {
  return content
    .split(/[\n\r,;\t]+/)
    .map(p => p.trim().replace(/["']/g, '').replace(/\D/g, ''))
    .filter(p => p.length >= 7 && p.length <= 15)
}

function parsePhonesFromJSON(content: string): string[] {
  try {
    const data = JSON.parse(content)
    if (Array.isArray(data)) {
      return data.flatMap(item => {
        if (typeof item === 'string') return [item.replace(/\D/g, '')]
        if (typeof item === 'object' && item) {
          const val = item.phone || item.number || item.tel || item.whatsapp || Object.values(item)[0]
          return val ? [String(val).replace(/\D/g, '')] : []
        }
        return []
      }).filter(p => p.length >= 7 && p.length <= 15)
    }
    return []
  } catch {
    return []
  }
}

export default function QuickSend({ sessions, campaigns, selectedPhone, onStatsRefresh }: Props) {
  const [tab, setTab] = useState<Tab>('send')

  const [to, setTo]           = useState('')
  const [text, setText]       = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult]   = useState<{ ok: boolean; msg: string } | null>(null)

  // Import state — importCampaignId: uses ALL campaigns (not session-filtered)
  const [importCampaignId, setImportCampaignId] = useState('')
  const [importing, setImporting]               = useState(false)
  const [importResult, setImportResult]         = useState<string | null>(null)
  const [parsedCount, setParsedCount]           = useState<number | null>(null)
  const [pastedText, setPastedText]             = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const selectedSession = sessions.find(s => s.phone === selectedPhone)
  const isOnline = selectedSession?.status === 'online'

  async function send() {
    if (!to.trim() || !text.trim() || !selectedPhone || !isOnline) return
    setSending(true); setResult(null)
    try {
      await api.sessions.send(selectedPhone, to.trim(), text.trim())
      setResult({ ok: true, msg: `✓ Отправлено на ${to.trim()} с ${selectedPhone}` })
      setTo(''); setText('')
    } catch (e: unknown) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : 'Ошибка отправки' })
    } finally {
      setSending(false)
    }
  }

  async function handleFile(file: File) {
    const content = await file.text()
    const ext = file.name.split('.').pop()?.toLowerCase()
    const phones = ext === 'json' ? parsePhonesFromJSON(content) : parsePhonesFromText(content)
    const unique = [...new Set(phones)]
    if (unique.length === 0) {
      setImportResult('✗ Не найдено валидных номеров в файле')
      setParsedCount(null)
      return
    }
    setParsedCount(unique.length)
    await submitPhones(unique)
  }

  async function handlePaste() {
    if (!pastedText.trim()) return
    const phones = parsePhonesFromText(pastedText)
    const unique = [...new Set(phones)]
    if (unique.length === 0) {
      setImportResult('✗ Не найдено валидных номеров')
      setParsedCount(null)
      return
    }
    setParsedCount(unique.length)
    await submitPhones(unique)
  }

  async function submitPhones(phones: string[]) {
    if (!importCampaignId) {
      setImportResult('✗ Сначала выбери кампанию')
      return
    }
    setImporting(true); setImportResult(null)
    try {
      const res = await api.leads.add(importCampaignId, phones)
      setImportResult(`✓ Загружено ${res.imported} номеров (${phones.length - res.imported} дубликатов пропущено)`)
      setPastedText('')
      if (fileRef.current) fileRef.current.value = ''
      onStatsRefresh()
    } catch (e: unknown) {
      setImportResult(`✗ ${e instanceof Error ? e.message : 'Ошибка импорта'}`)
    } finally {
      setImporting(false)
    }
  }

  if (!selectedPhone) {
    return (
      <section className="flex flex-col gap-2 items-center justify-center py-4">
        <span className="text-[#7d8590] text-xs">← Выбери сессию слева</span>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-3">
      {/* Tab header */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-green-400 font-bold tracking-widest uppercase text-xs">▸</span>
        <div className="flex items-center bg-[#0d1117] border border-[#30363d] rounded overflow-hidden">
          <button
            onClick={() => setTab('send')}
            className={`text-xs px-3 py-1.5 transition-colors cursor-pointer font-bold ${
              tab === 'send' ? 'bg-green-900/40 text-green-400' : 'text-[#7d8590] hover:text-[#e6edf3]'
            }`}
          >
            ✈ Быстрая отправка
          </button>
          <button
            onClick={() => setTab('import')}
            className={`text-xs px-3 py-1.5 transition-colors cursor-pointer font-bold border-l border-[#30363d] ${
              tab === 'import' ? 'bg-blue-900/40 text-blue-400' : 'text-[#7d8590] hover:text-[#e6edf3]'
            }`}
          >
            ⤴ Импорт базы
          </button>
        </div>
        <span className="text-[#7d8590] text-[10px] bg-[#21262d] border border-[#30363d] rounded px-1.5 py-0.5 font-mono">
          {selectedPhone}
        </span>
        {tab === 'send' && !isOnline && (
          <span className="text-red-400 text-[10px] font-bold">● Не в сети</span>
        )}
      </div>

      {/* ── Quick Send ── */}
      {tab === 'send' && (
        <>
          <div className="flex gap-2">
            <input
              className="w-44 bg-[#0d1117] border border-[#30363d] rounded px-2.5 py-1.5 text-xs text-[#e6edf3]
                         placeholder-[#7d8590] focus:outline-none focus:border-green-500 transition-colors"
              placeholder="Номер получателя"
              value={to}
              onChange={e => setTo(e.target.value)}
            />
            <input
              className="flex-1 min-w-0 bg-[#0d1117] border border-[#30363d] rounded px-2.5 py-1.5 text-xs text-[#e6edf3]
                         placeholder-[#7d8590] focus:outline-none focus:border-green-500 transition-colors"
              placeholder="Текст сообщения"
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !sending && to && text && send()}
            />
            <button
              onClick={send}
              disabled={sending || !to || !text || !isOnline}
              className="bg-green-600 hover:bg-green-500 disabled:bg-[#21262d] disabled:text-[#484f58]
                         text-black font-bold text-xs rounded px-4 py-1.5 transition-colors cursor-pointer
                         disabled:cursor-not-allowed whitespace-nowrap"
            >
              {sending ? '...' : '✈ Отправить'}
            </button>
          </div>
          {result && (
            <p className={`text-xs rounded px-2 py-1.5 ${
              result.ok ? 'text-green-400 bg-green-950/20 border border-green-900/50' : 'text-red-400 bg-red-950/20 border border-red-900/50'
            }`}>
              {result.msg}
            </p>
          )}
        </>
      )}

      {/* ── Import base ── */}
      {tab === 'import' && (
        <>
          {campaigns.length === 0 ? (
            <p className="text-[#7d8590] text-xs border border-[#30363d] rounded px-3 py-2.5 bg-[#0d1117]">
              ⚠ Сначала создай кампанию в разделе «Кампании» справа
            </p>
          ) : (
            <>
              {/* Campaign select + file upload */}
              <div className="flex gap-2 items-center flex-wrap">
                <select
                  className="flex-1 min-w-[180px] bg-[#0d1117] border border-[#30363d] rounded px-2.5 py-1.5 text-xs text-[#e6edf3]
                             focus:outline-none focus:border-blue-500 transition-colors cursor-pointer"
                  value={importCampaignId}
                  onChange={e => setImportCampaignId(e.target.value)}
                >
                  <option value="">── Выбери кампанию ──</option>
                  {campaigns.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.total_leads} лидов)
                    </option>
                  ))}
                </select>

                <input
                  ref={fileRef}
                  type="file"
                  accept=".txt,.csv,.json,.tsv"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={importing || !importCampaignId}
                  className="bg-blue-700 hover:bg-blue-600 disabled:bg-[#21262d] disabled:text-[#484f58]
                             text-white font-bold text-xs rounded px-4 py-1.5 transition-colors cursor-pointer
                             disabled:cursor-not-allowed whitespace-nowrap"
                  title={!importCampaignId ? 'Сначала выбери кампанию' : ''}
                >
                  {importing ? 'Загрузка...' : '📂 Загрузить файл'}
                </button>
              </div>

              {!importCampaignId && (
                <p className="text-[#7d8590] text-[10px]">↑ Выбери кампанию, затем загрузи файл или вставь номера ниже</p>
              )}

              <p className="text-[#7d8590] text-[10px]">
                Форматы: <span className="text-[#e6edf3]">.txt</span> (номер на строку),{' '}
                <span className="text-[#e6edf3]">.csv</span>,{' '}
                <span className="text-[#e6edf3]">.json</span> (массив строк или объектов с полем phone)
              </p>

              {/* Paste area */}
              <div className="flex gap-2">
                <textarea
                  rows={3}
                  className="flex-1 bg-[#0d1117] border border-[#30363d] rounded px-2.5 py-1.5 text-xs text-[#e6edf3]
                             placeholder-[#7d8590] focus:outline-none focus:border-blue-500 transition-colors resize-none"
                  placeholder={"Или вставь номера сюда:\n972501234567\n972509876543, 972521111111"}
                  value={pastedText}
                  onChange={e => setPastedText(e.target.value)}
                />
                <button
                  onClick={handlePaste}
                  disabled={importing || !importCampaignId || !pastedText.trim()}
                  className="bg-[#21262d] hover:bg-[#30363d] disabled:bg-[#21262d]/50 disabled:text-[#484f58]
                             text-[#e6edf3] text-xs rounded px-3 py-1.5 transition-colors cursor-pointer
                             disabled:cursor-not-allowed whitespace-nowrap border border-[#30363d]
                             disabled:border-[#21262d] self-end"
                  title={!importCampaignId ? 'Сначала выбери кампанию' : ''}
                >
                  {importing ? '...' : '+ Добавить'}
                </button>
              </div>
            </>
          )}

          {importResult && (
            <p className={`text-xs rounded px-2 py-1.5 ${
              importResult.startsWith('✓')
                ? 'text-green-400 bg-green-950/20 border border-green-900/50'
                : 'text-red-400 bg-red-950/20 border border-red-900/50'
            }`}>
              {importResult}
            </p>
          )}
          {parsedCount !== null && !importing && (
            <p className="text-[10px] text-[#7d8590]">Обнаружено {parsedCount} уникальных номеров в файле</p>
          )}
        </>
      )}
    </section>
  )
}
