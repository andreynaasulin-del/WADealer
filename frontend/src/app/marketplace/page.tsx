'use client'
import { useState, useEffect, useCallback } from 'react'
import { api, type MarketplaceAccount, type FarmAccount } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

function HealthBar({ score }: { score: number }) {
  const color = score >= 80 ? 'bg-green-500' : score >= 50 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 bg-zinc-800 rounded overflow-hidden">
        <div className={`h-full ${color} rounded`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs text-zinc-400 font-medium">{score}/100</span>
    </div>
  )
}

export default function MarketplacePage() {
  const { isAuthenticated, isLoading } = useAuth()
  const [available, setAvailable] = useState<MarketplaceAccount[]>([])
  const [myAccounts, setMyAccounts] = useState<FarmAccount[]>([])
  const [loading, setLoading] = useState(false)
  const [purchasing, setPurchasing] = useState<string | null>(null)
  const [tab, setTab] = useState<'browse' | 'my'>('browse')

  useEffect(() => {
    if (!isLoading && !isAuthenticated) window.location.href = '/login'
  }, [isAuthenticated, isLoading])

  const loadAvailable = useCallback(async () => {
    setLoading(true)
    try { setAvailable(await api.marketplace.accounts()) } catch (_) {}
    setLoading(false)
  }, [])

  const loadMyAccounts = useCallback(async () => {
    try { setMyAccounts(await api.marketplace.myAccounts()) } catch (_) {}
  }, [])

  useEffect(() => {
    if (isAuthenticated) { loadAvailable(); loadMyAccounts() }
  }, [isAuthenticated, loadAvailable, loadMyAccounts])

  const handlePurchase = async (id: string) => {
    if (!confirm('Purchase this account? It will be added to your sessions.')) return
    setPurchasing(id)
    try {
      const res = await api.marketplace.purchase(id)
      alert(`Purchased! Phone: ${res.phone_number}`)
      loadAvailable()
      loadMyAccounts()
    } catch (e) { alert((e as Error).message) }
    setPurchasing(null)
  }

  const handleReturn = async (id: string) => {
    if (!confirm('Return this account? Only possible within 24h if banned.')) return
    try {
      await api.marketplace.returnAccount(id)
      alert('Account returned')
      loadMyAccounts()
    } catch (e) { alert((e as Error).message) }
  }

  if (isLoading || !isAuthenticated) {
    return <div className="flex items-center justify-center h-screen text-zinc-500">Loading...</div>
  }

  return (
    <div className="min-h-screen p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Marketplace</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {available.length} accounts available | {myAccounts.length} purchased
          </p>
        </div>
        <div className="flex gap-2">
          <a href="/" className="px-3 py-1.5 bg-zinc-800 text-zinc-300 rounded hover:bg-zinc-700 text-sm">Home</a>
          <a href="/farm" className="px-3 py-1.5 bg-zinc-800 text-zinc-300 rounded hover:bg-zinc-700 text-sm">Farm</a>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6">
        <button onClick={() => setTab('browse')}
          className={`px-4 py-2 rounded text-sm ${tab === 'browse' ? 'bg-green-700 text-white' : 'bg-zinc-800 text-zinc-400'}`}>
          Browse ({available.length})
        </button>
        <button onClick={() => setTab('my')}
          className={`px-4 py-2 rounded text-sm ${tab === 'my' ? 'bg-green-700 text-white' : 'bg-zinc-800 text-zinc-400'}`}>
          My Accounts ({myAccounts.length})
        </button>
      </div>

      {tab === 'browse' ? (
        /* Available accounts */
        loading ? (
          <div className="text-center py-8 text-zinc-500">Loading...</div>
        ) : available.length === 0 ? (
          <div className="text-center py-12 text-zinc-500">
            No accounts available right now. Check back later.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {available.map(a => (
              <div key={a.id} className="bg-zinc-900 border border-green-800/50 rounded-lg p-4 hover:border-green-700 transition-colors">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-mono text-zinc-200">{a.phone_prefix}</span>
                  {a.sale_price_usd && (
                    <span className="text-lg font-bold text-green-400">${a.sale_price_usd}</span>
                  )}
                </div>

                <HealthBar score={a.health_score} />

                <div className="grid grid-cols-2 gap-1 mt-3 text-xs text-zinc-500">
                  <span>Age: {a.warmup_day} days</span>
                  <span>Sent: {a.messages_sent_total} msgs</span>
                  <span>Recv: {a.messages_received_total} msgs</span>
                  <span>Groups: {a.groups_joined}</span>
                  <span>Avatar: {a.has_avatar ? 'Yes' : 'No'}</span>
                  <span>Status: {a.has_status ? 'Yes' : 'No'}</span>
                </div>

                <div className="flex items-center gap-2 mt-3 text-xs">
                  <span className="bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">{a.provider}</span>
                  {a.ready_at && (
                    <span className="text-zinc-600">Ready: {new Date(a.ready_at).toLocaleDateString()}</span>
                  )}
                </div>

                <button
                  onClick={() => handlePurchase(a.id)}
                  disabled={purchasing === a.id}
                  className="mt-4 w-full py-2 bg-green-700 text-white rounded hover:bg-green-600 text-sm font-medium disabled:opacity-50"
                >
                  {purchasing === a.id ? 'Purchasing...' : 'Buy Now'}
                </button>
              </div>
            ))}
          </div>
        )
      ) : (
        /* My purchased accounts */
        myAccounts.length === 0 ? (
          <div className="text-center py-12 text-zinc-500">
            You haven&apos;t purchased any accounts yet.
          </div>
        ) : (
          <div className="space-y-3">
            {myAccounts.map(a => (
              <div key={a.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex items-center justify-between">
                <div>
                  <span className="font-mono text-zinc-200">{a.phone_number}</span>
                  <div className="flex items-center gap-3 mt-1">
                    <HealthBar score={a.health_score} />
                    <span className={`text-xs ${
                      a.stage === 'banned' ? 'text-red-400' :
                      a.stage === 'sold' ? 'text-purple-400' : 'text-green-400'
                    }`}>{a.stage}</span>
                    {a.sold_at && (
                      <span className="text-xs text-zinc-600">
                        Purchased: {new Date(a.sold_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
                {a.stage === 'banned' && a.sold_at && (
                  <button onClick={() => handleReturn(a.id)}
                    className="px-3 py-1.5 bg-red-800 text-red-200 rounded text-xs hover:bg-red-700">
                    Return (24h)
                  </button>
                )}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}
