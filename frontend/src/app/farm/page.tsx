'use client'
import { useState, useEffect, useCallback } from 'react'
import { api, type FarmAccount, type FarmStats } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

const STAGE_COLORS: Record<string, string> = {
  registered: 'text-zinc-400',
  verified: 'text-blue-400',
  warming: 'text-yellow-400',
  ready: 'text-green-400',
  sold: 'text-purple-400',
  active_user: 'text-cyan-400',
  banned: 'text-red-500',
  replaced: 'text-zinc-600',
}

const STAGE_BG: Record<string, string> = {
  registered: 'bg-zinc-800 border-zinc-700',
  verified: 'bg-blue-900/30 border-blue-800',
  warming: 'bg-yellow-900/30 border-yellow-800',
  ready: 'bg-green-900/30 border-green-800',
  sold: 'bg-purple-900/30 border-purple-800',
  active_user: 'bg-cyan-900/30 border-cyan-800',
  banned: 'bg-red-900/30 border-red-800',
  replaced: 'bg-zinc-900 border-zinc-800',
}

function HealthBar({ score }: { score: number }) {
  const color = score >= 80 ? 'bg-green-500' : score >= 50 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-2 bg-zinc-800 rounded overflow-hidden">
        <div className={`h-full ${color} rounded`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs text-zinc-400">{score}</span>
    </div>
  )
}

export default function FarmPage() {
  const { isAuthenticated, isLoading } = useAuth()
  const [accounts, setAccounts] = useState<FarmAccount[]>([])
  const [stats, setStats] = useState<FarmStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [stageFilter, setStageFilter] = useState('')

  // Add form
  const [showAdd, setShowAdd] = useState(false)
  const [addPhone, setAddPhone] = useState('')
  const [addProvider, setAddProvider] = useState('manual')
  const [addCost, setAddCost] = useState('')
  const [addProxy, setAddProxy] = useState('')
  const [addName, setAddName] = useState('')
  const [addOwnerType, setAddOwnerType] = useState('platform')

  // Connect own
  const [showConnect, setShowConnect] = useState(false)
  const [connectPhone, setConnectPhone] = useState('')
  const [connectProxy, setConnectProxy] = useState('')

  useEffect(() => {
    if (!isLoading && !isAuthenticated) window.location.href = '/login'
  }, [isAuthenticated, isLoading])

  const loadAccounts = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (stageFilter) params.stage = stageFilter
      setAccounts(await api.farm.accounts.list(params))
    } catch (_) {}
    setLoading(false)
  }, [stageFilter])

  const loadStats = useCallback(async () => {
    try { setStats(await api.farm.stats()) } catch (_) {}
  }, [])

  useEffect(() => {
    if (isAuthenticated) { loadAccounts(); loadStats() }
  }, [isAuthenticated, loadAccounts, loadStats])

  const handleCreate = async () => {
    if (!addPhone.trim()) return
    try {
      await api.farm.accounts.create({
        phone_number: addPhone.trim(),
        provider: addProvider,
        cost_usd: addCost ? Number(addCost) : undefined,
        proxy_string: addProxy || undefined,
        display_name: addName || undefined,
        owner_type: addOwnerType as 'platform' | 'user',
      })
      setAddPhone(''); setAddCost(''); setAddProxy(''); setAddName('')
      setShowAdd(false)
      loadAccounts(); loadStats()
    } catch (e) { alert((e as Error).message) }
  }

  const handleConnectOwn = async () => {
    if (!connectPhone.trim()) return
    try {
      await api.farm.connectOwn(connectPhone.trim(), connectProxy || undefined)
      setConnectPhone(''); setConnectProxy('')
      setShowConnect(false)
      loadAccounts(); loadStats()
    } catch (e) { alert((e as Error).message) }
  }

  const handleStartWarmup = async (id: string) => {
    try {
      await api.farm.accounts.startWarmup(id)
      loadAccounts()
    } catch (e) { alert((e as Error).message) }
  }

  const handleRecalcHealth = async (id: string) => {
    try {
      await api.farm.accounts.recalcHealth(id)
      loadAccounts()
    } catch (e) { alert((e as Error).message) }
  }

  if (isLoading || !isAuthenticated) {
    return <div className="flex items-center justify-center h-screen text-zinc-500">Loading...</div>
  }

  const stages = ['', 'registered', 'verified', 'warming', 'ready', 'sold', 'active_user', 'banned']

  return (
    <div className="min-h-screen p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">WA Farm</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {stats ? (
              <>
                {stats.total} accounts | avg health: {stats.avg_health} |
                {Object.entries(stats.by_stage).map(([s, c]) => (
                  <span key={s} className={`ml-2 ${STAGE_COLORS[s] || 'text-zinc-400'}`}>{s}: {c}</span>
                ))}
              </>
            ) : '...'}
          </p>
        </div>
        <div className="flex gap-2">
          <a href="/" className="px-3 py-1.5 bg-zinc-800 text-zinc-300 rounded hover:bg-zinc-700 text-sm">Home</a>
          <a href="/marketplace" className="px-3 py-1.5 bg-zinc-800 text-zinc-300 rounded hover:bg-zinc-700 text-sm">Marketplace</a>
          <button onClick={() => setShowConnect(!showConnect)} className="px-3 py-1.5 bg-cyan-700 text-white rounded hover:bg-cyan-600 text-sm">
            Connect Own WA
          </button>
          <button onClick={() => setShowAdd(!showAdd)} className="px-3 py-1.5 bg-green-700 text-white rounded hover:bg-green-600 text-sm">
            + Add Account
          </button>
        </div>
      </div>

      {/* Connect own WhatsApp */}
      {showConnect && (
        <div className="bg-zinc-900 border border-cyan-800 rounded-lg p-4 mb-4">
          <h3 className="text-sm font-medium text-cyan-300 mb-3">Connect Your Own WhatsApp for Farming</h3>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-xs text-zinc-500 mb-1">Phone Number</label>
              <input value={connectPhone} onChange={e => setConnectPhone(e.target.value)}
                placeholder="972501234567" className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-zinc-500 mb-1">Proxy (optional)</label>
              <input value={connectProxy} onChange={e => setConnectProxy(e.target.value)}
                placeholder="user:pass@host:port" className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
            </div>
            <button onClick={handleConnectOwn} className="px-4 py-2 bg-cyan-700 text-white rounded hover:bg-cyan-600 text-sm">Connect</button>
          </div>
          <p className="text-xs text-zinc-500 mt-2">Your account will be monitored (health, ban detection). We will NOT send messages from it.</p>
        </div>
      )}

      {/* Add new farm account (admin) */}
      {showAdd && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Phone</label>
              <input value={addPhone} onChange={e => setAddPhone(e.target.value)}
                placeholder="972501234567" className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Provider</label>
              <select value={addProvider} onChange={e => setAddProvider(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200">
                <option value="manual">Manual</option>
                <option value="5sim">5sim</option>
                <option value="sms-activate">SMS Activate</option>
                <option value="esim">eSIM</option>
                <option value="gsm">GSM Gateway</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Cost (USD)</label>
              <input value={addCost} onChange={e => setAddCost(e.target.value)} type="number" step="0.01"
                placeholder="1.50" className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Proxy</label>
              <input value={addProxy} onChange={e => setAddProxy(e.target.value)}
                placeholder="user:pass@host:port" className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Display Name</label>
              <input value={addName} onChange={e => setAddName(e.target.value)}
                placeholder="David" className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Owner</label>
              <select value={addOwnerType} onChange={e => setAddOwnerType(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200">
                <option value="platform">Platform</option>
                <option value="user">User</option>
              </select>
            </div>
          </div>
          <button onClick={handleCreate} className="mt-3 px-4 py-2 bg-green-700 text-white rounded hover:bg-green-600 text-sm">
            Create Account
          </button>
        </div>
      )}

      {/* Stage filter */}
      <div className="flex gap-1 mb-4 flex-wrap">
        {stages.map(s => (
          <button key={s} onClick={() => setStageFilter(s)}
            className={`px-3 py-1.5 rounded text-xs ${
              stageFilter === s ? 'bg-green-700 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}>
            {s || 'All'}
          </button>
        ))}
      </div>

      {/* Accounts grid */}
      {loading ? (
        <div className="text-center py-8 text-zinc-500">Loading...</div>
      ) : accounts.length === 0 ? (
        <div className="text-center py-12 text-zinc-500">
          No farm accounts yet. Add one to get started.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map(a => (
            <div key={a.id} className={`rounded-lg border p-4 ${STAGE_BG[a.stage] || 'bg-zinc-900 border-zinc-800'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-sm text-zinc-200">{a.phone_number}</span>
                <span className={`text-xs font-medium ${STAGE_COLORS[a.stage]}`}>{a.stage.toUpperCase()}</span>
              </div>

              <HealthBar score={a.health_score} />

              <div className="grid grid-cols-2 gap-1 mt-3 text-xs text-zinc-500">
                <span>Day: {a.warmup_day}</span>
                <span>Sent: {a.messages_sent_total}</span>
                <span>Recv: {a.messages_received_total}</span>
                <span>Groups: {a.groups_joined}</span>
                <span>Avatar: {a.has_avatar ? 'Y' : 'N'}</span>
                <span>Status: {a.has_status ? 'Y' : 'N'}</span>
                <span>Owner: {a.owner_type}</span>
                <span>Bans: {a.ban_count}</span>
              </div>

              {a.display_name && <p className="text-xs text-zinc-400 mt-2">Name: {a.display_name}</p>}
              {a.sale_price_usd && <p className="text-xs text-green-400 mt-1">${a.sale_price_usd}</p>}

              <div className="flex gap-2 mt-3">
                {(a.stage === 'registered' || a.stage === 'verified') && (
                  <button onClick={() => handleStartWarmup(a.id)}
                    className="px-2 py-1 bg-yellow-700 text-white rounded text-xs hover:bg-yellow-600">
                    Start Warmup
                  </button>
                )}
                <button onClick={() => handleRecalcHealth(a.id)}
                  className="px-2 py-1 bg-zinc-700 text-zinc-300 rounded text-xs hover:bg-zinc-600">
                  Recalc Health
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
