'use client'
import { useState, useEffect, useCallback } from 'react'
import { api, type BlacklistEntry, type BlacklistStats } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

const REASONS = [
  { value: '', label: 'All' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'complained', label: 'Complained' },
  { value: 'blocked_us', label: 'Blocked us' },
  { value: 'manual', label: 'Manual' },
  { value: 'spam_report', label: 'Spam report' },
]

const REASON_COLORS: Record<string, string> = {
  contacted: 'text-blue-400',
  complained: 'text-red-400',
  blocked_us: 'text-red-500',
  manual: 'text-yellow-400',
  spam_report: 'text-orange-400',
}

const SCOPE_BADGE: Record<string, string> = {
  global: 'bg-red-900/50 text-red-300 border-red-700',
  team: 'bg-zinc-800 text-zinc-400 border-zinc-700',
}

export default function BlacklistPage() {
  const { isAuthenticated, isLoading } = useAuth()

  const [entries, setEntries] = useState<BlacklistEntry[]>([])
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<BlacklistStats | null>(null)
  const [filter, setFilter] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)

  // Add form
  const [showAdd, setShowAdd] = useState(false)
  const [addPhone, setAddPhone] = useState('')
  const [addReason, setAddReason] = useState('manual')
  const [addNote, setAddNote] = useState('')

  // Bulk import
  const [showBulk, setShowBulk] = useState(false)
  const [bulkPhones, setBulkPhones] = useState('')
  const [bulkReason, setBulkReason] = useState('manual')

  // Check phone
  const [checkPhone, setCheckPhone] = useState('')
  const [checkResult, setCheckResult] = useState<{ phone: string; blocked: boolean } | null>(null)

  const LIMIT = 50

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      window.location.href = '/login'
    }
  }, [isAuthenticated, isLoading])

  const loadEntries = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = { limit: String(LIMIT), offset: String(page * LIMIT) }
      if (filter) params.reason = filter
      if (search) params.search = search
      const res = await api.blacklist.list(params)
      setEntries(res.items)
      setTotal(res.total)
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [filter, search, page])

  const loadStats = useCallback(async () => {
    try { setStats(await api.blacklist.stats()) } catch (_) {}
  }, [])

  useEffect(() => {
    if (isAuthenticated) {
      loadEntries()
      loadStats()
    }
  }, [isAuthenticated, loadEntries, loadStats])

  const handleAdd = async () => {
    if (!addPhone.trim()) return
    try {
      await api.blacklist.add(addPhone.trim(), addReason, addNote || undefined)
      setAddPhone('')
      setAddNote('')
      setShowAdd(false)
      loadEntries()
      loadStats()
    } catch (e) { alert((e as Error).message) }
  }

  const handleBulkAdd = async () => {
    const phones = bulkPhones.split(/[\n,;]+/).map(p => p.trim()).filter(Boolean)
    if (phones.length === 0) return
    try {
      const res = await api.blacklist.bulkAdd(phones, bulkReason)
      alert(`Added ${res.added} phones to blacklist`)
      setBulkPhones('')
      setShowBulk(false)
      loadEntries()
      loadStats()
    } catch (e) { alert((e as Error).message) }
  }

  const handleRemove = async (phone: string) => {
    if (!confirm(`Remove ${phone} from blacklist?`)) return
    try {
      await api.blacklist.remove(phone)
      loadEntries()
      loadStats()
    } catch (e) { alert((e as Error).message) }
  }

  const handleCheck = async () => {
    if (!checkPhone.trim()) return
    try {
      setCheckResult(await api.blacklist.check(checkPhone.trim()))
    } catch (e) { alert((e as Error).message) }
  }

  if (isLoading || !isAuthenticated) {
    return <div className="flex items-center justify-center h-screen text-zinc-500">Loading...</div>
  }

  const totalPages = Math.ceil(total / LIMIT)

  return (
    <div className="min-h-screen p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Blacklist</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {stats ? `${stats.total} total` : '...'}{' '}
            {stats && Object.entries(stats.by_reason).map(([r, c]) => (
              <span key={r} className={`ml-3 ${REASON_COLORS[r] || 'text-zinc-400'}`}>
                {r}: {c}
              </span>
            ))}
          </p>
        </div>
        <div className="flex gap-2">
          <a href="/" className="px-3 py-1.5 bg-zinc-800 text-zinc-300 rounded hover:bg-zinc-700 text-sm">
            Home
          </a>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="px-3 py-1.5 bg-green-700 text-white rounded hover:bg-green-600 text-sm"
          >
            + Add
          </button>
          <button
            onClick={() => setShowBulk(!showBulk)}
            className="px-3 py-1.5 bg-zinc-700 text-zinc-200 rounded hover:bg-zinc-600 text-sm"
          >
            Bulk Import
          </button>
        </div>
      </div>

      {/* Add single phone */}
      {showAdd && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-4">
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-xs text-zinc-500 mb-1">Phone</label>
              <input
                value={addPhone} onChange={e => setAddPhone(e.target.value)}
                placeholder="972501234567"
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Reason</label>
              <select
                value={addReason} onChange={e => setAddReason(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
              >
                {REASONS.filter(r => r.value).map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-zinc-500 mb-1">Note (optional)</label>
              <input
                value={addNote} onChange={e => setAddNote(e.target.value)}
                placeholder="VIP client"
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
              />
            </div>
            <button onClick={handleAdd} className="px-4 py-2 bg-green-700 text-white rounded hover:bg-green-600 text-sm">
              Add
            </button>
          </div>
        </div>
      )}

      {/* Bulk import */}
      {showBulk && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-4">
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-xs text-zinc-500 mb-1">Phones (one per line, or comma-separated)</label>
              <textarea
                value={bulkPhones} onChange={e => setBulkPhones(e.target.value)}
                rows={4}
                placeholder="972501234567&#10;972502345678&#10;972503456789"
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 font-mono"
              />
            </div>
            <div className="flex flex-col gap-2">
              <select
                value={bulkReason} onChange={e => setBulkReason(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
              >
                {REASONS.filter(r => r.value).map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              <button onClick={handleBulkAdd} className="px-4 py-2 bg-green-700 text-white rounded hover:bg-green-600 text-sm">
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Check phone */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-4">
        <div className="flex gap-3 items-center">
          <input
            value={checkPhone} onChange={e => { setCheckPhone(e.target.value); setCheckResult(null) }}
            placeholder="Check phone: 972501234567"
            onKeyDown={e => e.key === 'Enter' && handleCheck()}
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
          />
          <button onClick={handleCheck} className="px-4 py-2 bg-zinc-700 text-zinc-200 rounded hover:bg-zinc-600 text-sm">
            Check
          </button>
          {checkResult && (
            <span className={`text-sm font-medium ${checkResult.blocked ? 'text-red-400' : 'text-green-400'}`}>
              {checkResult.blocked ? 'BLOCKED' : 'NOT BLOCKED'}
            </span>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0) }}
          placeholder="Search by phone..."
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
        />
        <div className="flex gap-1">
          {REASONS.map(r => (
            <button
              key={r.value}
              onClick={() => { setFilter(r.value); setPage(0) }}
              className={`px-3 py-1.5 rounded text-xs ${
                filter === r.value
                  ? 'bg-green-700 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-800/50">
            <tr className="text-zinc-500 text-xs">
              <th className="text-left px-4 py-2">Phone</th>
              <th className="text-left px-4 py-2">Reason</th>
              <th className="text-left px-4 py-2">Scope</th>
              <th className="text-left px-4 py-2">Session</th>
              <th className="text-left px-4 py-2">Note</th>
              <th className="text-left px-4 py-2">Date</th>
              <th className="text-right px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-8 text-zinc-500">Loading...</td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8 text-zinc-500">No entries</td></tr>
            ) : entries.map(e => (
              <tr key={e.id} className="border-t border-zinc-800 hover:bg-zinc-800/30">
                <td className="px-4 py-2 font-mono text-zinc-200">{e.phone}</td>
                <td className={`px-4 py-2 ${REASON_COLORS[e.reason] || 'text-zinc-400'}`}>{e.reason}</td>
                <td className="px-4 py-2">
                  <span className={`text-xs px-2 py-0.5 rounded border ${SCOPE_BADGE[e.scope]}`}>
                    {e.scope}
                  </span>
                </td>
                <td className="px-4 py-2 text-zinc-500 font-mono text-xs">{e.contacted_by_session || '-'}</td>
                <td className="px-4 py-2 text-zinc-500 text-xs max-w-[200px] truncate">{e.note || '-'}</td>
                <td className="px-4 py-2 text-zinc-500 text-xs">
                  {e.created_at ? new Date(e.created_at).toLocaleDateString('ru-RU') : '-'}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => handleRemove(e.phone)}
                    className="text-red-500 hover:text-red-400 text-xs"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-xs text-zinc-500">{total} entries</span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1 bg-zinc-800 text-zinc-400 rounded text-xs disabled:opacity-30"
            >
              Prev
            </button>
            <span className="px-3 py-1 text-zinc-500 text-xs">{page + 1} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1 bg-zinc-800 text-zinc-400 rounded text-xs disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
