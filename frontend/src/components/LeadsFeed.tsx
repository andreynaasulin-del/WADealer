'use client'
import { useState, useEffect, useCallback } from 'react'
import { api, type FeedLead, type GirlProfile } from '@/lib/api'

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

function LeadCard({ lead, profile, onCreateProfile, onExclude }: {
  lead: FeedLead
  profile: GirlProfile | undefined
  onCreateProfile: (leadId: string) => void
  onExclude: (leadId: string, excluded: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const c = CAT_COLOR[lead.category] ?? CAT_COLOR.COLD
  const isExcluded = lead.profile_excluded

  return (
    <div
      className={`border rounded-lg p-3 cursor-pointer transition-all ${c.border} hover:brightness-110 ${isExcluded ? 'opacity-40' : ''}`}
      onClick={() => setOpen(o => !o)}
    >
      {/* Row 1: score + phone + category */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className={`font-bold text-xl tabular-nums ${c.text}`}>{lead.score}</span>
          <span className="text-zinc-300 text-xs font-mono">+{lead.phone}</span>
          {lead.nickname && <span className="text-zinc-500 text-[10px]">{lead.nickname}</span>}
        </div>
        <div className="flex items-center gap-1.5">
          {profile && (
            <button
              onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(`https://tahles.top/p/${profile.slug}`) }}
              title={`Profile: /p/${profile.slug}`}
              className="text-[9px] px-1.5 py-0.5 rounded bg-pink-500/20 text-pink-400 hover:bg-pink-500/30"
            >
              /p/{profile.slug}
            </button>
          )}
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${c.badge}`}>{lead.category}</span>
        </div>
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

      {/* Expanded details + profile actions */}
      {open && (
        <div className="mt-2 pt-2 border-t border-zinc-800">
          <div className="text-[10px] text-zinc-500 space-y-0.5 mb-2">
            {lead.address && lead.address !== lead.city && <p>📌 {lead.address}</p>}
            {lead.price_text && <p>💵 {lead.price_text}</p>}
            {lead.availability && <p>🕐 {lead.availability}</p>}
            {lead.services && lead.services.length > 0 && <p>🔧 {lead.services.join(' · ')}</p>}
            {lead.sentiment && <p>😊 {lead.sentiment}</p>}
          </div>

          {/* Profile actions for HOT leads */}
          {lead.category === 'HOT' && (
            <div className="flex items-center gap-2 pt-1 border-t border-zinc-800/50">
              {!profile && !isExcluded && (
                <button
                  onClick={e => { e.stopPropagation(); setCreating(true); onCreateProfile(lead.id) }}
                  disabled={creating}
                  className="text-[10px] px-2 py-1 rounded bg-pink-600/30 text-pink-300 hover:bg-pink-600/50 disabled:opacity-50 cursor-pointer"
                >
                  {creating ? '...' : 'Create Profile'}
                </button>
              )}
              {profile && (
                <button
                  onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(`https://tahles.top/p/${profile.slug}`) }}
                  className="text-[10px] px-2 py-1 rounded bg-pink-600/20 text-pink-300 hover:bg-pink-600/30 cursor-pointer"
                >
                  Copy Link
                </button>
              )}
              <button
                onClick={e => { e.stopPropagation(); onExclude(lead.id, !isExcluded) }}
                className={`text-[10px] px-2 py-1 rounded cursor-pointer ${isExcluded
                  ? 'bg-green-600/20 text-green-400 hover:bg-green-600/30'
                  : 'bg-zinc-700/30 text-zinc-500 hover:bg-zinc-700/50'
                }`}
              >
                {isExcluded ? 'Include' : 'Exclude'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function LeadsFeed({ onClose }: Props) {
  const [leads, setLeads]       = useState<FeedLead[]>([])
  const [profiles, setProfiles] = useState<GirlProfile[]>([])
  const [loading, setLoading]   = useState(true)
  const [scoring, setScoring]   = useState(false)
  const [scoreMsg, setScoreMsg] = useState<string | null>(null)
  const [minScore, setMinScore] = useState(20)

  const loadFeed = useCallback(async (ms = minScore) => {
    setLoading(true)
    try {
      const [feedRes, profileList] = await Promise.all([
        api.leads.feed(ms, 500),
        api.profiles.list().catch(() => []),
      ])
      setLeads(feedRes.leads || [])
      setProfiles(profileList)
    } catch { setLeads([]) }
    setLoading(false)
  }, [minScore])

  useEffect(() => { loadFeed() }, [loadFeed])

  const runScore = async () => {
    setScoring(true); setScoreMsg(null)
    try {
      const r = await api.leads.batchScore()
      setScoreMsg(`Done: ${r.scored} scored, ${r.skipped} skipped`)
      await loadFeed()
    } catch (e) {
      setScoreMsg('Error: ' + (e instanceof Error ? e.message : 'error'))
    }
    setScoring(false)
  }

  const handleCreateProfile = async (leadId: string) => {
    try {
      await api.profiles.createFromLead(leadId)
      const newProfiles = await api.profiles.list().catch(() => [])
      setProfiles(newProfiles)
    } catch (e) {
      alert('Error: ' + (e instanceof Error ? e.message : 'Failed'))
    }
  }

  const handleExclude = async (leadId: string, excluded: boolean) => {
    try {
      await api.profiles.excludeLead(leadId, excluded)
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, profile_excluded: excluded } : l))
    } catch {}
  }

  // Build lead→profile map by lead_id
  const profileByLeadId = new Map<string, GirlProfile>()
  for (const p of profiles) {
    if (p.lead_id) profileByLeadId.set(p.lead_id, p)
  }

  // Stats
  const hot  = leads.filter(l => l.category === 'HOT' && !l.profile_excluded).length
  const warm = leads.filter(l => l.category === 'WARM').length
  const cold = leads.filter(l => l.category === 'COLD').length

  // Warning insert index: right after last HOT
  const hotEndIdx = leads.findIndex(l => l.category !== 'HOT')

  return (
    <div className="bg-[#0d1117] border border-[#30363d] rounded-xl overflow-clip">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#30363d] bg-[#161b22]">
        <div className="flex items-center gap-3">
          <h2 className="text-white font-semibold text-sm">Leads Feed</h2>
          <div className="flex gap-1.5 text-[10px]">
            <span className="bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-bold">{hot} HOT</span>
            <span className="bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded font-bold">{warm} WARM</span>
            <span className="bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded font-bold">{cold} COLD</span>
            {profiles.length > 0 && (
              <span className="bg-pink-500/20 text-pink-400 px-1.5 py-0.5 rounded font-bold">{profiles.length} Profiles</span>
            )}
          </div>
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
            {scoring ? '...' : 'Score All'}
          </button>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-lg leading-none cursor-pointer">&times;</button>
        </div>
      </div>

      {scoreMsg && (
        <div className="px-4 py-1.5 bg-purple-950/20 border-b border-purple-900/30 text-purple-300 text-[10px]">
          {scoreMsg}
        </div>
      )}

      {/* Feed */}
      <div className="overflow-y-auto min-h-[300px] max-h-[62vh] p-3 space-y-2">
        {loading ? (
          <p className="text-zinc-500 text-xs text-center py-8">Loading leads...</p>
        ) : leads.length === 0 ? (
          <p className="text-zinc-500 text-xs text-center py-8">No leads with data (score &gt;= {minScore})</p>
        ) : (
          leads.map((lead, idx) => (
            <div key={lead.phone}>
              {hotEndIdx > 0 && idx === hotEndIdx && (
                <div className="my-3 p-3 bg-amber-950/30 border border-amber-700/40 rounded-lg text-right" dir="rtl">
                  <p className="text-amber-400 font-bold text-sm mb-1">&#9888;&#65039; Important</p>
                  <p className="text-amber-300/80 text-xs leading-relaxed">
                    Even with checks and high scores, 100% reliability cannot be guaranteed.
                    <br />
                    Never transfer money in advance.
                  </p>
                </div>
              )}
              <LeadCard
                lead={lead}
                profile={profileByLeadId.get(lead.id)}
                onCreateProfile={handleCreateProfile}
                onExclude={handleExclude}
              />
            </div>
          ))
        )}
      </div>
    </div>
  )
}
