'use client'
import { useState, useEffect, useCallback } from 'react'
import { api, type FeedLead } from '@/lib/api'

interface Props {
  campaignId: string
  onClose: () => void
}

const CAT_COLOR = {
  HOT:       { border: 'border-red-900/50 bg-red-950/20',       text: 'text-red-400',    badge: 'bg-red-500/20 text-red-400' },
  WARM:      { border: 'border-yellow-900/50 bg-yellow-950/20', text: 'text-yellow-400', badge: 'bg-yellow-500/20 text-yellow-400' },
  COLD:      { border: 'border-blue-900/50 bg-blue-950/20',     text: 'text-blue-400',   badge: 'bg-blue-500/20 text-blue-400' },
  IRRELEVANT:{ border: 'border-zinc-800 bg-zinc-900/30',        text: 'text-zinc-500',   badge: 'bg-zinc-700/30 text-zinc-500' },
}

function fmt(v: unknown, maxLen = 30): string {
  if (!v) return ''
  const s = String(v)
  return s.length > maxLen ? s.slice(0, maxLen - 2) + '..' : s
}

function LeadCard({ lead }: { lead: FeedLead }) {
  const [open, setOpen] = useState(false)
  const c = CAT_COLOR[lead.category] ?? CAT_COLOR.COLD

  return (
    <div
      className={`border rounded-lg p-3 cursor-pointer transition-all ${c.border} hover:brightness-110`}
      onClick={() => setOpen(o => !o)}
    >
      {/* Row 1: score + phone + category */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className={`font-bold text-xl tabular-nums ${c.text}`}>{lead.score}</span>
          <span className="text-zinc-300 text-xs font-mono">+{lead.phone}</span>
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${c.badge}`}>{lead.category}</span>
      </div>

      {/* Row 2: summary chips */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-zinc-400">
        {(lead.city || lead.address) && (
          <span title={lead.address ?? undefined}>
            <span className="text-zinc-600">📍</span> {fmt(lead.city || lead.address)}
          </span>
        )}
        {(lead.price_text || lead.price_min) && (
          <span title={lead.price_text ?? undefined}>
            <span className="text-zinc-600">💰</span> {fmt(lead.price_text || (lead.price_min && lead.price_max && lead.price_min !== lead.price_max ? `${lead.price_min}-${lead.price_max}` : String(lead.price_min ?? '')))}
          </span>
        )}
        {lead.nationality && (
          <span><span className="text-zinc-600">🌍</span> {lead.nationality}</span>
        )}
        {lead.independent_or_agency && (
          <span><span className="text-zinc-600">👤</span> {lead.independent_or_agency}</span>
        )}
        {lead.incall_outcall && (
          <span><span className="text-zinc-600">🏠</span> {lead.incall_outcall}</span>
        )}
        {lead.age && (
          <span><span className="text-zinc-600">🎂</span> {lead.age}</span>
        )}
        {lead.has_photos && <span>📷</span>}
        {lead.has_video  && <span>🎬</span>}
      </div>

      {/* Expanded details */}
      {open && (
        <div className="mt-2 pt-2 border-t border-zinc-800 text-[10px] text-zinc-500 space-y-0.5">
          {lead.address && lead.address !== lead.city && <p>📌 {lead.address}</p>}
          {lead.price_text && <p>💵 {lead.price_text}</p>}
          {lead.availability && <p>🕐 {lead.availability}</p>}
          {lead.services && lead.services.length > 0 && <p>🔧 {lead.services.join(' · ')}</p>}
          {lead.sentiment && <p>😊 {lead.sentiment}</p>}
        </div>
      )}
    </div>
  )
}

export default function LeadsFeed({ onClose }: Props) {
  const [leads, setLeads]       = useState<FeedLead[]>([])
  const [loading, setLoading]   = useState(true)
  const [scoring, setScoring]   = useState(false)
  const [scoreMsg, setScoreMsg] = useState<string | null>(null)
  const [minScore, setMinScore] = useState(20)

  const loadFeed = useCallback(async (ms = minScore) => {
    setLoading(true)
    try {
      const res = await api.leads.feed(ms, 500)
      setLeads(res.leads || [])
    } catch { setLeads([]) }
    setLoading(false)
  }, [minScore])

  useEffect(() => { loadFeed() }, [loadFeed])

  const runScore = async () => {
    setScoring(true); setScoreMsg(null)
    try {
      const r = await api.leads.batchScore()
      setScoreMsg(`✅ ${r.scored} scored, ${r.skipped} skipped`)
      await loadFeed()
    } catch (e) {
      setScoreMsg('❌ ' + (e instanceof Error ? e.message : 'error'))
    }
    setScoring(false)
  }

  // Stats
  const hot  = leads.filter(l => l.category === 'HOT').length
  const warm = leads.filter(l => l.category === 'WARM').length
  const cold = leads.filter(l => l.category === 'COLD').length

  // Warning insert index: right after last HOT
  const hotEndIdx = leads.findIndex(l => l.category !== 'HOT')

  return (
    <div className="bg-[#0d1117] border border-[#30363d] rounded-xl overflow-clip">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#30363d] bg-[#161b22]">
        <div className="flex items-center gap-3">
          <h2 className="text-white font-semibold text-sm">Leads Feed</h2>
          <div className="flex gap-1.5 text-[10px]">
            <span className="bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-bold">{hot} HOT</span>
            <span className="bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded font-bold">{warm} WARM</span>
            <span className="bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded font-bold">{cold} COLD</span>
          </div>
          {/* min score filter */}
          <select
            value={minScore}
            onChange={e => { const v = Number(e.target.value); setMinScore(v); loadFeed(v) }}
            className="text-[10px] bg-[#0d1117] border border-[#30363d] text-zinc-400 rounded px-1 py-0.5"
          >
            <option value={20}>≥20 (COLD+)</option>
            <option value={50}>≥50 (WARM+)</option>
            <option value={80}>≥80 (HOT only)</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={runScore}
            disabled={scoring}
            className="text-[10px] px-2 py-1 rounded bg-purple-600/30 text-purple-300 hover:bg-purple-600/50 disabled:opacity-50 cursor-pointer"
          >
            {scoring ? '⏳' : '⚡ Score All'}
          </button>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-lg leading-none cursor-pointer">&times;</button>
        </div>
      </div>

      {scoreMsg && (
        <div className="px-4 py-1.5 bg-purple-950/20 border-b border-purple-900/30 text-purple-300 text-[10px]">
          {scoreMsg}
        </div>
      )}

      {/* ── Feed ── */}
      <div className="overflow-y-auto min-h-[300px] max-h-[62vh] p-3 space-y-2">
        {loading ? (
          <p className="text-zinc-500 text-xs text-center py-8">Загрузка лидов...</p>
        ) : leads.length === 0 ? (
          <p className="text-zinc-500 text-xs text-center py-8">Нет лидов с данными (score ≥ {minScore})</p>
        ) : (
          leads.map((lead, idx) => (
            <div key={lead.phone}>
              {/* Hebrew warning banner between HOT and WARM */}
              {hotEndIdx > 0 && idx === hotEndIdx && (
                <div className="my-3 p-3 bg-amber-950/30 border border-amber-700/40 rounded-lg text-right" dir="rtl">
                  <p className="text-amber-400 font-bold text-sm mb-1">⚠️ חשוב לדעת</p>
                  <p className="text-amber-300/80 text-xs leading-relaxed">
                    גם עם בדיקות וציון גבוה לא ניתן להבטיח אמינות ב-100%.
                    <br />
                    אל תעבירו כסף מראש לאף אחד.
                  </p>
                </div>
              )}
              <LeadCard lead={lead} />
            </div>
          ))
        )}
      </div>
    </div>
  )
}
