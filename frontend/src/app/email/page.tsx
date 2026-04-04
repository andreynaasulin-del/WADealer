'use client'
import { useState, useEffect, useCallback } from 'react'
import { api, type EmailAccount, type EmailCampaign, type EmailStats } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

export default function EmailDashboard() {
  const { isAuthenticated, isLoading } = useAuth()
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([])
  const [stats, setStats] = useState<EmailStats | null>(null)
  const [tab, setTab] = useState<'accounts' | 'campaigns'>('accounts')
  const [showAddAccount, setShowAddAccount] = useState(false)
  const [showAddCampaign, setShowAddCampaign] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)

  // ── Auth redirect ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoading && !isAuthenticated) window.location.href = '/login'
  }, [isAuthenticated, isLoading])

  // ── Loaders ───────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    try {
      const [a, c, s] = await Promise.all([
        api.email.accounts.list(),
        api.email.campaigns.list(),
        api.email.stats(),
      ])
      setAccounts(a)
      setCampaigns(c)
      setStats(s)
    } catch {}
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  // ── Add account form ──────────────────────────────────────────────────────
  const [form, setForm] = useState({
    email: '', display_name: '', smtp_host: '', smtp_port: '587',
    smtp_user: '', smtp_pass: '', daily_limit: '50',
  })

  async function handleAddAccount(e: React.FormEvent) {
    e.preventDefault()
    try {
      await api.email.accounts.create({
        email: form.email,
        display_name: form.display_name || undefined,
        smtp_host: form.smtp_host,
        smtp_port: parseInt(form.smtp_port) || 587,
        smtp_user: form.smtp_user,
        smtp_pass: form.smtp_pass,
        daily_limit: parseInt(form.daily_limit) || 50,
      })
      setShowAddAccount(false)
      setForm({ email: '', display_name: '', smtp_host: '', smtp_port: '587', smtp_user: '', smtp_pass: '', daily_limit: '50' })
      await loadAll()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  async function handleTestAccount(id: string) {
    setTesting(id)
    try {
      const res = await api.email.accounts.test(id)
      alert(res.message || 'OK')
      await loadAll()
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setTesting(null)
    }
  }

  async function handleDeleteAccount(id: string) {
    if (!confirm('Удалить email аккаунт?')) return
    try {
      await api.email.accounts.remove(id)
      await loadAll()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  // ── Campaign form ─────────────────────────────────────────────────────────
  const [campForm, setCampForm] = useState({
    name: '', subject: '', body_html: '', from_account_id: '',
  })

  async function handleAddCampaign(e: React.FormEvent) {
    e.preventDefault()
    try {
      await api.email.campaigns.create({
        name: campForm.name,
        subject: campForm.subject,
        body_html: campForm.body_html,
        from_account_id: campForm.from_account_id || undefined,
      })
      setShowAddCampaign(false)
      setCampForm({ name: '', subject: '', body_html: '', from_account_id: '' })
      await loadAll()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  async function handleDeleteCampaign(id: string) {
    if (!confirm('Удалить кампанию?')) return
    try {
      await api.email.campaigns.remove(id)
      await loadAll()
    } catch (err) {
      alert((err as Error).message)
    }
  }

  if (isLoading) return <div className="min-h-screen bg-black" />

  const statusIcon = (s: string) =>
    s === 'online' ? '🟢' : s === 'error' ? '🔴' : '⚫'

  const campIcon = (s: string) =>
    s === 'running' ? '▶️' : s === 'paused' ? '⏸' : s === 'completed' ? '✅' : s === 'error' ? '❌' : '📝'

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <a href="/dashboard" className="text-zinc-500 hover:text-zinc-300 text-sm">Dashboard</a>
            <span className="text-zinc-700">/</span>
            <h1 className="text-lg font-bold text-orange-400">Email Outreach</h1>
          </div>
          {stats && (
            <div className="flex items-center gap-4 text-xs text-zinc-500">
              <span>Аккаунтов: <b className="text-zinc-300">{stats.accounts_online}/{stats.accounts_total}</b></span>
              <span>Отправлено сегодня: <b className="text-orange-400">{stats.sent_today}</b></span>
              <span>Кампаний: <b className="text-zinc-300">{stats.campaigns_running}/{stats.campaigns_total}</b></span>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* ── Tabs ────────────────────────────────────────────────────────── */}
        <div className="flex gap-2">
          <button
            onClick={() => setTab('accounts')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'accounts'
                ? 'bg-orange-600 text-white'
                : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
            }`}
          >
            📧 Email аккаунты ({accounts.length})
          </button>
          <button
            onClick={() => setTab('campaigns')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'campaigns'
                ? 'bg-orange-600 text-white'
                : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
            }`}
          >
            📢 Кампании ({campaigns.length})
          </button>
        </div>

        {/* ══ ACCOUNTS TAB ═══════════════════════════════════════════════════ */}
        {tab === 'accounts' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold">SMTP аккаунты</h2>
              <button
                onClick={() => setShowAddAccount(!showAddAccount)}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                + Добавить аккаунт
              </button>
            </div>

            {showAddAccount && (
              <form onSubmit={handleAddAccount} className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <input placeholder="Email *" value={form.email} onChange={e => setForm({...form, email: e.target.value})}
                    className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" required />
                  <input placeholder="Display Name" value={form.display_name} onChange={e => setForm({...form, display_name: e.target.value})}
                    className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                  <input placeholder="SMTP Host *" value={form.smtp_host} onChange={e => setForm({...form, smtp_host: e.target.value})}
                    className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" required />
                  <input placeholder="SMTP Port" value={form.smtp_port} onChange={e => setForm({...form, smtp_port: e.target.value})}
                    className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                  <input placeholder="SMTP User *" value={form.smtp_user} onChange={e => setForm({...form, smtp_user: e.target.value})}
                    className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" required />
                  <input placeholder="SMTP Password *" type="password" value={form.smtp_pass} onChange={e => setForm({...form, smtp_pass: e.target.value})}
                    className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" required />
                  <input placeholder="Daily Limit" value={form.daily_limit} onChange={e => setForm({...form, daily_limit: e.target.value})}
                    className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="flex gap-2">
                  <button type="submit" className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm">Добавить</button>
                  <button type="button" onClick={() => setShowAddAccount(false)} className="px-4 py-2 bg-zinc-800 text-zinc-400 rounded-lg text-sm">Отмена</button>
                </div>
              </form>
            )}

            {accounts.length === 0 ? (
              <div className="text-center py-12 text-zinc-600">
                <p className="text-4xl mb-3">📧</p>
                <p>Нет email аккаунтов</p>
                <p className="text-sm mt-1">Добавьте SMTP аккаунт для рассылки</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {accounts.map(acc => (
                  <div key={acc.id} className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">{statusIcon(acc.status)}</span>
                      <div>
                        <p className="font-medium">{acc.display_name || acc.email}</p>
                        <p className="text-xs text-zinc-500">{acc.email} | {acc.smtp_host}:{acc.smtp_port}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right text-xs text-zinc-500">
                        <p>Отправлено: {acc.sent_today}/{acc.daily_limit}</p>
                        {acc.last_error && <p className="text-red-500 truncate max-w-48">{acc.last_error}</p>}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleTestAccount(acc.id)}
                          disabled={testing === acc.id}
                          className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs disabled:opacity-50"
                        >
                          {testing === acc.id ? '...' : 'Test'}
                        </button>
                        <button
                          onClick={() => handleDeleteAccount(acc.id)}
                          className="px-3 py-1.5 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded-lg text-xs"
                        >
                          Del
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══ CAMPAIGNS TAB ══════════════════════════════════════════════════ */}
        {tab === 'campaigns' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold">Email кампании</h2>
              <button
                onClick={() => setShowAddCampaign(!showAddCampaign)}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                + Новая кампания
              </button>
            </div>

            {showAddCampaign && (
              <form onSubmit={handleAddCampaign} className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 space-y-3">
                <input placeholder="Название кампании *" value={campForm.name} onChange={e => setCampForm({...campForm, name: e.target.value})}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" required />
                <input placeholder="Тема письма (Subject) *" value={campForm.subject} onChange={e => setCampForm({...campForm, subject: e.target.value})}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" required />
                <textarea placeholder="HTML тело письма *" value={campForm.body_html} onChange={e => setCampForm({...campForm, body_html: e.target.value})}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm h-32" required />
                <select value={campForm.from_account_id} onChange={e => setCampForm({...campForm, from_account_id: e.target.value})}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm">
                  <option value="">Любой аккаунт</option>
                  {accounts.filter(a => a.status === 'online').map(a => (
                    <option key={a.id} value={a.id}>{a.email}</option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button type="submit" className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm">Создать</button>
                  <button type="button" onClick={() => setShowAddCampaign(false)} className="px-4 py-2 bg-zinc-800 text-zinc-400 rounded-lg text-sm">Отмена</button>
                </div>
              </form>
            )}

            {campaigns.length === 0 ? (
              <div className="text-center py-12 text-zinc-600">
                <p className="text-4xl mb-3">📢</p>
                <p>Нет email кампаний</p>
                <p className="text-sm mt-1">Создайте кампанию для массовой email рассылки</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {campaigns.map(camp => (
                  <div key={camp.id} className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">{campIcon(camp.status)}</span>
                      <div>
                        <p className="font-medium">{camp.name}</p>
                        <p className="text-xs text-zinc-500">
                          Subject: {camp.subject} | {camp.sent_count}/{camp.total_leads} sent
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className={`text-xs px-2 py-1 rounded ${
                        camp.status === 'running' ? 'bg-green-900/40 text-green-400' :
                        camp.status === 'paused' ? 'bg-yellow-900/40 text-yellow-400' :
                        camp.status === 'completed' ? 'bg-blue-900/40 text-blue-400' :
                        camp.status === 'error' ? 'bg-red-900/40 text-red-400' :
                        'bg-zinc-800 text-zinc-400'
                      }`}>
                        {camp.status}
                      </span>
                      <button
                        onClick={() => handleDeleteCampaign(camp.id)}
                        className="px-3 py-1.5 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded-lg text-xs"
                      >
                        Del
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
