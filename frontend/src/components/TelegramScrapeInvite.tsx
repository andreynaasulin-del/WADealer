'use client'
import { useState, useEffect, useCallback } from 'react'
import {
  api,
  type TelegramAccount,
  type SourceGroup,
  type ScrapedMembersStats,
  type ScrapeStatus,
  type InviteStatus,
} from '@/lib/api'

interface Props {
  accounts: TelegramAccount[]
  selectedAccountId: string | null
}

export default function TelegramScrapeInvite({ accounts, selectedAccountId }: Props) {
  const [groups, setGroups]               = useState<SourceGroup[]>([])
  const [stats, setStats]                 = useState<ScrapedMembersStats | null>(null)
  const [scrapeStatus, setScrapeStatus]   = useState<ScrapeStatus>({ status: 'idle' })
  const [inviteStatus, setInviteStatus]   = useState<InviteStatus>({ status: 'idle' })
  const [linksText, setLinksText]         = useState('')
  const [targetChannel, setTargetChannel] = useState('')
  const [dailyLimit, setDailyLimit]       = useState(50)
  const [loading, setLoading]             = useState(false)
  const [section, setSection]             = useState<'groups' | 'scrape' | 'invite'>('groups')

  const activeAccounts = accounts.filter(a => a.status === 'active')
  const accountId = selectedAccountId || activeAccounts[0]?.id

  // ── Load data ───────────────────────────────────────────────────────────────
  const loadGroups = useCallback(async () => {
    try { setGroups(await api.telegram.sourceGroups.list()) } catch {}
  }, [])

  const loadStats = useCallback(async () => {
    try { setStats(await api.telegram.scrapedMembers.stats()) } catch {}
  }, [])

  const loadScrapeStatus = useCallback(async () => {
    try { setScrapeStatus(await api.telegram.scrape.status()) } catch {}
  }, [])

  const loadInviteStatus = useCallback(async () => {
    try { setInviteStatus(await api.telegram.invite.status()) } catch {}
  }, [])

  useEffect(() => {
    loadGroups()
    loadStats()
    loadScrapeStatus()
    loadInviteStatus()
    const t = setInterval(() => {
      loadGroups()
      loadStats()
      loadScrapeStatus()
      loadInviteStatus()
    }, 5000)
    return () => clearInterval(t)
  }, [loadGroups, loadStats, loadScrapeStatus, loadInviteStatus])

  // ── Actions ─────────────────────────────────────────────────────────────────
  const addGroups = async () => {
    const links = linksText
      .split('\n')
      .map(l => l.replace(/^\d+[\.\)]\s*/, '').trim())
      .filter(l => l.includes('t.me/'))
    if (links.length === 0) return
    setLoading(true)
    try {
      await api.telegram.sourceGroups.add(links)
      setLinksText('')
      await loadGroups()
    } catch (e: unknown) {
      alert((e as Error).message)
    }
    setLoading(false)
  }

  const removeGroup = async (id: string) => {
    await api.telegram.sourceGroups.remove(id)
    await loadGroups()
  }

  const startScrape = async (groupId?: string) => {
    if (!accountId) return alert('Нет активных аккаунтов')
    try {
      await api.telegram.scrape.start(accountId, groupId)
      await loadScrapeStatus()
    } catch (e: unknown) {
      alert((e as Error).message)
    }
  }

  const stopScrape = async () => {
    await api.telegram.scrape.stop()
    await loadScrapeStatus()
  }

  const startInvite = async () => {
    if (!accountId) return alert('Нет активных аккаунтов')
    if (!targetChannel.trim()) return alert('Укажите канал')
    try {
      await api.telegram.invite.start(accountId, targetChannel.trim(), dailyLimit)
      await loadInviteStatus()
    } catch (e: unknown) {
      alert((e as Error).message)
    }
  }

  const stopInvite = async () => {
    await api.telegram.invite.stop()
    await loadInviteStatus()
  }

  // ── Status badges ───────────────────────────────────────────────────────────
  const statusColor = (s: string) => {
    switch (s) {
      case 'scraped': return 'text-green-400'
      case 'scraping': case 'joined': return 'text-yellow-400'
      case 'error': return 'text-red-400'
      default: return 'text-zinc-500'
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-blue-400 tracking-wider">▸ ПАРСИНГ & ИНВАЙТ</h2>
        <div className="flex gap-1 text-xs">
          {(['groups', 'scrape', 'invite'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setSection(tab)}
              className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${
                section === tab
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tab === 'groups' ? 'Группы' : tab === 'scrape' ? 'Парсинг' : 'Инвайт'}
            </button>
          ))}
        </div>
      </div>

      {/* Stats summary */}
      {stats && (
        <div className="flex gap-3 mb-3 text-xs">
          <span className="text-zinc-500">Участников: <span className="text-blue-400 font-bold">{stats.total}</span></span>
          <span className="text-zinc-500">Pending: <span className="text-yellow-400">{stats.pending}</span></span>
          <span className="text-zinc-500">Invited: <span className="text-green-400">{stats.invited}</span></span>
          <span className="text-zinc-500">Failed: <span className="text-red-400">{stats.failed}</span></span>
          <span className="text-zinc-500">Skip: <span className="text-zinc-400">{stats.skipped}</span></span>
        </div>
      )}

      {/* ── Section A: Groups ──────────────────────────────────────────────── */}
      {section === 'groups' && (
        <div>
          <textarea
            value={linksText}
            onChange={e => setLinksText(e.target.value)}
            placeholder="Вставьте ссылки t.me/... (по одной на строку)"
            className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-xs text-zinc-300 h-24 resize-none mb-2 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={addGroups}
            disabled={loading || !linksText.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 px-3 py-1 rounded text-xs cursor-pointer transition-colors mb-3"
          >
            {loading ? 'Добавляю...' : '+ Добавить группы'}
          </button>

          {groups.length > 0 && (
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-zinc-600 border-b border-zinc-800">
                    <th className="text-left py-1 px-1">#</th>
                    <th className="text-left py-1 px-1">Ссылка</th>
                    <th className="text-left py-1 px-1">Название</th>
                    <th className="text-right py-1 px-1">Участн.</th>
                    <th className="text-center py-1 px-1">Статус</th>
                    <th className="text-right py-1 px-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g, i) => (
                    <tr key={g.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                      <td className="py-1 px-1 text-zinc-600">{i + 1}</td>
                      <td className="py-1 px-1 text-zinc-400 max-w-[200px] truncate">{g.link}</td>
                      <td className="py-1 px-1 text-zinc-300">{g.title || '—'}</td>
                      <td className="py-1 px-1 text-right text-zinc-400">{g.member_count || '—'}</td>
                      <td className={`py-1 px-1 text-center ${statusColor(g.status)}`}>{g.status}</td>
                      <td className="py-1 px-1 text-right">
                        <button
                          onClick={() => removeGroup(g.id)}
                          className="text-zinc-600 hover:text-red-400 cursor-pointer text-xs"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Section B: Scrape ──────────────────────────────────────────────── */}
      {section === 'scrape' && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs text-zinc-500">Аккаунт:</span>
            <span className="text-xs text-blue-400">
              {activeAccounts.find(a => a.id === accountId)?.username
                || activeAccounts.find(a => a.id === accountId)?.phone
                || 'нет активных'}
            </span>
          </div>

          {scrapeStatus.status === 'running' ? (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="flex-1 h-2 bg-zinc-800 rounded overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all"
                    style={{ width: `${scrapeStatus.total ? (scrapeStatus.progress! / scrapeStatus.total * 100) : 0}%` }}
                  />
                </div>
                <span className="text-xs text-zinc-400">
                  {scrapeStatus.progress}/{scrapeStatus.total}
                </span>
              </div>
              <button
                onClick={stopScrape}
                className="bg-red-600/20 text-red-400 hover:bg-red-600/30 px-3 py-1 rounded text-xs cursor-pointer"
              >
                ■ Стоп
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => startScrape()}
                disabled={!accountId || groups.length === 0}
                className="bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 px-3 py-1 rounded text-xs cursor-pointer transition-colors"
              >
                ▶ Парсить все группы
              </button>
              {scrapeStatus.status === 'completed' && (
                <span className="text-xs text-green-400 self-center">Завершено!</span>
              )}
            </div>
          )}

          {/* Per-group scrape buttons */}
          {groups.length > 0 && (
            <div className="mt-3 max-h-48 overflow-y-auto">
              {groups.map(g => (
                <div key={g.id} className="flex items-center justify-between py-1 border-b border-zinc-800/30 text-xs">
                  <span className={`${statusColor(g.status)}`}>
                    {g.title || g.link.replace('https://t.me/', '')} — {g.status}
                    {g.member_count ? ` (${g.member_count})` : ''}
                  </span>
                  {g.status !== 'scraped' && g.status !== 'scraping' && (
                    <button
                      onClick={() => startScrape(g.id)}
                      disabled={!accountId}
                      className="text-blue-400 hover:text-blue-300 cursor-pointer"
                    >
                      парсить
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Section C: Invite ──────────────────────────────────────────────── */}
      {section === 'invite' && (
        <div>
          <div className="flex gap-2 mb-2">
            <input
              value={targetChannel}
              onChange={e => setTargetChannel(e.target.value)}
              placeholder="t.me/yourchannel"
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 focus:outline-none focus:border-blue-500"
            />
            <input
              type="number"
              value={dailyLimit}
              onChange={e => setDailyLimit(parseInt(e.target.value) || 50)}
              className="w-16 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 text-center focus:outline-none focus:border-blue-500"
              title="Лимит/день"
            />
          </div>

          {inviteStatus.status === 'running' ? (
            <div>
              <div className="text-xs text-zinc-400 mb-2">
                Приглашено: <span className="text-green-400 font-bold">{inviteStatus.invited || 0}</span>
                {' / '}{inviteStatus.dailyLimit || dailyLimit}
                {' | '}Ошибок: <span className="text-red-400">{inviteStatus.failed || 0}</span>
              </div>
              <button
                onClick={stopInvite}
                className="bg-red-600/20 text-red-400 hover:bg-red-600/30 px-3 py-1 rounded text-xs cursor-pointer"
              >
                ■ Стоп
              </button>
            </div>
          ) : (
            <div>
              <button
                onClick={startInvite}
                disabled={!accountId || !targetChannel.trim() || !stats?.pending}
                className="bg-green-600 hover:bg-green-500 disabled:bg-zinc-700 disabled:text-zinc-500 px-3 py-1 rounded text-xs cursor-pointer transition-colors"
              >
                ▶ Начать инвайт ({stats?.pending || 0} pending)
              </button>
              {inviteStatus.status === 'rate_limited' && (
                <span className="text-xs text-red-400 ml-2">PeerFlood — лимит исчерпан, попробуйте завтра</span>
              )}
              {inviteStatus.status === 'completed' && (
                <span className="text-xs text-green-400 ml-2">
                  Завершено! Приглашено: {inviteStatus.invited}
                </span>
              )}
            </div>
          )}

          <p className="text-xs text-zinc-600 mt-2">
            ~50 инвайтов/день на аккаунт. При PeerFlood автостоп.
          </p>
        </div>
      )}
    </div>
  )
}
