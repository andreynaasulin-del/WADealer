'use client'
import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { api, type TeamData, type TeamMember, type TeamInvite, type Session, type TelegramAccount } from '@/lib/api'

export default function TeamPage() {
  const { isAuthenticated, isLoading, user, logout } = useAuth()

  const [team, setTeam] = useState<TeamData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [time, setTime] = useState('')

  // ── Create team state ──────────────────────────────────────────────────────
  const [newTeamName, setNewTeamName] = useState('')
  const [creatingTeam, setCreatingTeam] = useState(false)

  // ── Join team state ────────────────────────────────────────────────────────
  const [joinToken, setJoinToken] = useState('')
  const [joiningTeam, setJoiningTeam] = useState(false)

  // ── Invite modal ───────────────────────────────────────────────────────────
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteRole, setInviteRole] = useState('operator')
  const [inviteEmail, setInviteEmail] = useState('')
  const [generatedInvite, setGeneratedInvite] = useState<TeamInvite | null>(null)
  const [creatingInvite, setCreatingInvite] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)

  // ── Operator status ────────────────────────────────────────────────────────
  const [operatorStatus, setOperatorStatus] = useState<string>('offline')

  // ── Resources ──────────────────────────────────────────────────────────────
  const [waSessions, setWaSessions] = useState<Session[]>([])
  const [tgAccounts, setTgAccounts] = useState<TelegramAccount[]>([])

  // ── Auth redirect ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoading && !isAuthenticated) window.location.href = '/login'
  }, [isAuthenticated, isLoading])

  // ── Clock ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const fmt = () => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setTime(fmt())
    const t = setInterval(() => setTime(fmt()), 1000)
    return () => clearInterval(t)
  }, [])

  // ── Load team data ─────────────────────────────────────────────────────────
  const loadTeam = useCallback(async () => {
    try {
      const data = await api.teams.getCurrent()
      setTeam(data)
      setError(null)
    } catch (e) {
      const msg = (e as Error).message
      if (msg.includes('404') || msg.includes('not found') || msg.includes('нет команды')) {
        setTeam(null)
      } else {
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  const loadResources = useCallback(async () => {
    try { setWaSessions(await api.sessions.list()) } catch {}
    try { setTgAccounts(await api.telegram.accounts.list()) } catch {}
  }, [])

  useEffect(() => {
    if (!isAuthenticated) return
    loadTeam()
    loadResources()
    const timer = setInterval(() => { loadTeam() }, 10_000)
    return () => clearInterval(timer)
  }, [loadTeam, loadResources, isAuthenticated])

  // ── Detect current user status from team ───────────────────────────────────
  useEffect(() => {
    if (team && user) {
      const me = team.members.find(m => m.id === user.id)
      if (me) setOperatorStatus(me.status || 'offline')
    }
  }, [team, user])

  // ── Handlers ───────────────────────────────────────────────────────────────

  async function handleCreateTeam() {
    if (!newTeamName.trim()) return
    setCreatingTeam(true)
    try {
      await api.teams.create(newTeamName.trim())
      await loadTeam()
      setNewTeamName('')
    } catch (e) {
      setError((e as Error).message)
    }
    setCreatingTeam(false)
  }

  async function handleJoinTeam() {
    if (!joinToken.trim()) return
    setJoiningTeam(true)
    try {
      await api.teams.join(joinToken.trim())
      await loadTeam()
      setJoinToken('')
    } catch (e) {
      setError((e as Error).message)
    }
    setJoiningTeam(false)
  }

  async function handleCreateInvite() {
    setCreatingInvite(true)
    try {
      const invite = await api.teams.createInvite(
        inviteRole,
        inviteEmail.trim() || undefined
      )
      setGeneratedInvite(invite)
    } catch (e) {
      setError((e as Error).message)
    }
    setCreatingInvite(false)
  }

  function copyInviteLink() {
    if (!generatedInvite) return
    const link = `https://www.wadealer.org/invite/${generatedInvite.token}`
    navigator.clipboard.writeText(link).then(() => {
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2000)
    })
  }

  async function handleChangeRole(userId: string, newRole: string) {
    try {
      await api.teams.updateMemberRole(userId, newRole)
      await loadTeam()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleRemoveMember(userId: string) {
    try {
      await api.teams.removeMember(userId)
      await loadTeam()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleStatusChange(status: string) {
    setOperatorStatus(status)
    try {
      await api.teams.updateOperatorStatus(status)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function handleToggleResource(userId: string, resourceType: string, resourceId: string, assigned: boolean) {
    try {
      if (assigned) {
        await api.teams.unassignResource(userId, resourceType, resourceId)
      } else {
        await api.teams.assignResource(userId, resourceType, resourceId)
      }
      await loadTeam()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  const isAdmin = user?.team_role === 'admin' || user?.role === 'admin'
  const isManager = user?.team_role === 'manager'
  const canManage = isAdmin || isManager

  function roleBadge(role: string) {
    const colors: Record<string, string> = {
      admin: 'bg-red-900/40 text-red-400 border-red-800',
      manager: 'bg-amber-900/40 text-amber-400 border-amber-800',
      operator: 'bg-blue-900/40 text-blue-400 border-blue-800',
    }
    return colors[role] || 'bg-zinc-800 text-zinc-400 border-zinc-700'
  }

  function statusDot(status: string) {
    if (status === 'online') return 'bg-green-400'
    if (status === 'busy') return 'bg-yellow-400'
    return 'bg-zinc-600'
  }

  // ── Loading ────────────────────────────────────────────────────────────────

  if (isLoading || !isAuthenticated) {
    return (
      <div className="h-screen bg-[#0d1117] flex items-center justify-center">
        <div className="text-[#7d8590] text-sm font-mono">...</div>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen bg-[#0d1117] text-[#e6edf3] font-mono flex flex-col overflow-hidden">

      {/* Header */}
      <header className="border-b border-[#30363d] px-2 sm:px-4 py-2 flex items-center justify-between shrink-0 bg-[#161b22]">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <a href="/" className="text-[#7d8590] hover:text-[#e6edf3] text-xs transition-colors shrink-0">
            &larr; <span className="hidden sm:inline">Menu</span>
          </a>
          <span className="text-green-400 font-bold text-xs sm:text-sm tracking-wider shrink-0">
            &diams; TEAM
          </span>
          {team && (
            <span className="text-[#7d8590] text-xs hidden lg:block truncate">
              {team.name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          {/* Status selector */}
          {team && (
            <select
              value={operatorStatus}
              onChange={e => handleStatusChange(e.target.value)}
              className="text-[10px] sm:text-xs bg-[#0d1117] border border-[#30363d] text-[#e6edf3] rounded px-2 py-1 cursor-pointer focus:outline-none focus:border-green-700"
            >
              <option value="online">Online</option>
              <option value="busy">Busy</option>
              <option value="offline">Offline</option>
            </select>
          )}
          {time && <span className="text-[#484f58] text-xs hidden md:block tabular-nums">{time}</span>}
          <button onClick={logout} className="text-xs text-[#7d8590] hover:text-red-400 transition-colors cursor-pointer px-1" title="Exit">
            &perp;
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-3 sm:p-6">
        <div className="max-w-4xl mx-auto flex flex-col gap-6">

          {/* Error banner */}
          {error && (
            <div className="bg-red-950/30 border border-red-900/50 rounded-lg px-4 py-2 text-red-400 text-xs flex items-center justify-between">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="text-red-600 hover:text-red-400 cursor-pointer ml-2">x</button>
            </div>
          )}

          {/* ── No team ────────────────────────────────────────────────────────── */}
          {!loading && !team && (
            <div className="flex flex-col gap-6">
              {/* Create team */}
              <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-6">
                <h2 className="text-green-400 font-bold text-sm tracking-wider uppercase mb-4">
                  Crear equipo / Create team
                </h2>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newTeamName}
                    onChange={e => setNewTeamName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleCreateTeam()}
                    placeholder="Team name..."
                    className="flex-1 bg-[#0d1117] border border-[#30363d] rounded px-3 py-2 text-sm text-[#e6edf3] placeholder:text-[#484f58] focus:outline-none focus:border-green-700"
                  />
                  <button
                    onClick={handleCreateTeam}
                    disabled={creatingTeam || !newTeamName.trim()}
                    className="bg-green-600 hover:bg-green-500 disabled:bg-[#21262d] disabled:text-[#484f58] text-black font-bold text-xs rounded px-4 py-2 transition-colors cursor-pointer disabled:cursor-not-allowed"
                  >
                    {creatingTeam ? '...' : 'Create'}
                  </button>
                </div>
              </div>

              {/* Join by invite */}
              <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-6">
                <h2 className="text-blue-400 font-bold text-sm tracking-wider uppercase mb-4">
                  Join by invite
                </h2>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={joinToken}
                    onChange={e => setJoinToken(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleJoinTeam()}
                    placeholder="Invite token..."
                    className="flex-1 bg-[#0d1117] border border-[#30363d] rounded px-3 py-2 text-sm text-[#e6edf3] placeholder:text-[#484f58] focus:outline-none focus:border-blue-700"
                  />
                  <button
                    onClick={handleJoinTeam}
                    disabled={joiningTeam || !joinToken.trim()}
                    className="bg-blue-600 hover:bg-blue-500 disabled:bg-[#21262d] disabled:text-[#484f58] text-black font-bold text-xs rounded px-4 py-2 transition-colors cursor-pointer disabled:cursor-not-allowed"
                  >
                    {joiningTeam ? '...' : 'Join'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Has team ───────────────────────────────────────────────────────── */}
          {!loading && team && (
            <>
              {/* Section 1: Members */}
              <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4 sm:p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-green-400 font-bold text-sm tracking-wider uppercase">
                    Members
                  </h2>
                  <span className="text-[#7d8590] text-xs">
                    {team.members.length} members, {team.members.filter(m => m.status === 'online').length} online
                  </span>
                </div>

                <div className="flex flex-col gap-2">
                  {team.members.map(member => (
                    <div
                      key={member.id}
                      className="flex items-center gap-3 bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2.5"
                    >
                      {/* Status dot */}
                      <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${statusDot(member.status)}`} />

                      {/* Name + email */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-[#e6edf3] truncate">
                            {member.display_name}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${roleBadge(member.team_role)}`}>
                            {member.team_role}
                          </span>
                        </div>
                        <span className="text-[#484f58] text-[10px]">{member.email}</span>
                      </div>

                      {/* Admin controls */}
                      {isAdmin && member.id !== user?.id && (
                        <div className="flex items-center gap-2 shrink-0">
                          <select
                            value={member.team_role}
                            onChange={e => handleChangeRole(member.id, e.target.value)}
                            className="text-[10px] bg-[#0d1117] border border-[#30363d] text-[#7d8590] rounded px-1.5 py-0.5 cursor-pointer focus:outline-none focus:border-green-700"
                          >
                            <option value="operator">operator</option>
                            <option value="manager">manager</option>
                            <option value="admin">admin</option>
                          </select>
                          <button
                            onClick={() => handleRemoveMember(member.id)}
                            className="text-[10px] text-[#7d8590] hover:text-red-400 transition-colors cursor-pointer"
                            title="Remove member"
                          >
                            x
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Section 2: Invite (admin/manager only) */}
              {canManage && (
                <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4 sm:p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-amber-400 font-bold text-sm tracking-wider uppercase">
                      Invite
                    </h2>
                    <button
                      onClick={() => {
                        setShowInviteModal(true)
                        setGeneratedInvite(null)
                        setInviteEmail('')
                        setInviteRole('operator')
                        setCopiedLink(false)
                      }}
                      className="bg-amber-600 hover:bg-amber-500 text-black font-bold text-xs rounded px-3 py-1 transition-colors cursor-pointer"
                    >
                      + Create invite
                    </button>
                  </div>

                  {/* Invite modal */}
                  {showInviteModal && (
                    <div className="bg-[#0d1117] border border-[#30363d] rounded-lg p-4 mt-2">
                      <div className="flex flex-col gap-3">
                        {/* Role selector */}
                        <div>
                          <label className="text-[#7d8590] text-[10px] uppercase tracking-wider block mb-1">Role</label>
                          <select
                            value={inviteRole}
                            onChange={e => setInviteRole(e.target.value)}
                            className="w-full bg-[#161b22] border border-[#30363d] text-[#e6edf3] rounded px-3 py-2 text-sm cursor-pointer focus:outline-none focus:border-amber-700"
                          >
                            <option value="operator">Operator</option>
                            <option value="manager">Manager</option>
                          </select>
                        </div>

                        {/* Optional email */}
                        <div>
                          <label className="text-[#7d8590] text-[10px] uppercase tracking-wider block mb-1">Email (optional)</label>
                          <input
                            type="email"
                            value={inviteEmail}
                            onChange={e => setInviteEmail(e.target.value)}
                            placeholder="user@example.com"
                            className="w-full bg-[#161b22] border border-[#30363d] text-[#e6edf3] rounded px-3 py-2 text-sm placeholder:text-[#484f58] focus:outline-none focus:border-amber-700"
                          />
                        </div>

                        {/* Generate button */}
                        {!generatedInvite && (
                          <button
                            onClick={handleCreateInvite}
                            disabled={creatingInvite}
                            className="bg-amber-600 hover:bg-amber-500 disabled:bg-[#21262d] disabled:text-[#484f58] text-black font-bold text-xs rounded px-4 py-2 transition-colors cursor-pointer disabled:cursor-not-allowed self-start"
                          >
                            {creatingInvite ? '...' : 'Generate'}
                          </button>
                        )}

                        {/* Generated link */}
                        {generatedInvite && (
                          <div className="flex flex-col gap-2">
                            <div className="bg-[#161b22] border border-green-900/50 rounded px-3 py-2">
                              <code className="text-[10px] sm:text-xs text-green-400 break-all">
                                https://www.wadealer.org/invite/{generatedInvite.token}
                              </code>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={copyInviteLink}
                                className="bg-green-600 hover:bg-green-500 text-black font-bold text-xs rounded px-3 py-1 transition-colors cursor-pointer"
                              >
                                {copiedLink ? 'Copied!' : 'Copy link'}
                              </button>
                              <button
                                onClick={() => setShowInviteModal(false)}
                                className="text-xs text-[#7d8590] hover:text-[#e6edf3] transition-colors cursor-pointer px-2"
                              >
                                Close
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Section 3: Resource Assignments (admin/manager only) */}
              {canManage && (waSessions.length > 0 || tgAccounts.length > 0) && (
                <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4 sm:p-6">
                  <h2 className="text-purple-400 font-bold text-sm tracking-wider uppercase mb-4">
                    Resource assignments
                  </h2>

                  <div className="flex flex-col gap-4">
                    {team.members.map(member => (
                      <div key={member.id} className="bg-[#0d1117] border border-[#30363d] rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-3">
                          <span className={`inline-block w-1.5 h-1.5 rounded-full ${statusDot(member.status)}`} />
                          <span className="text-sm text-[#e6edf3]">{member.display_name}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${roleBadge(member.team_role)}`}>
                            {member.team_role}
                          </span>
                        </div>

                        {/* WA Sessions */}
                        {waSessions.length > 0 && (
                          <div className="mb-2">
                            <span className="text-[#7d8590] text-[10px] uppercase tracking-wider">WhatsApp sessions</span>
                            <div className="flex flex-wrap gap-2 mt-1">
                              {waSessions.map(s => {
                                const assigned = member.assigned_wa_sessions?.includes(s.phone) || false
                                return (
                                  <label
                                    key={s.phone}
                                    className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded border cursor-pointer transition-colors ${
                                      assigned
                                        ? 'border-green-800 bg-green-950/30 text-green-400'
                                        : 'border-[#30363d] bg-[#161b22] text-[#7d8590] hover:border-[#484f58]'
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={assigned}
                                      onChange={() => handleToggleResource(member.id, 'wa_session', s.phone, assigned)}
                                      className="accent-green-500 w-3 h-3"
                                    />
                                    <span>{s.phone}</span>
                                  </label>
                                )
                              })}
                            </div>
                          </div>
                        )}

                        {/* TG Accounts */}
                        {tgAccounts.length > 0 && (
                          <div>
                            <span className="text-[#7d8590] text-[10px] uppercase tracking-wider">Telegram accounts</span>
                            <div className="flex flex-wrap gap-2 mt-1">
                              {tgAccounts.map(a => {
                                const assigned = member.assigned_tg_accounts?.includes(a.id) || false
                                return (
                                  <label
                                    key={a.id}
                                    className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded border cursor-pointer transition-colors ${
                                      assigned
                                        ? 'border-blue-800 bg-blue-950/30 text-blue-400'
                                        : 'border-[#30363d] bg-[#161b22] text-[#7d8590] hover:border-[#484f58]'
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={assigned}
                                      onChange={() => handleToggleResource(member.id, 'tg_account', a.id, assigned)}
                                      className="accent-blue-500 w-3 h-3"
                                    />
                                    <span>{a.username ? `@${a.username}` : a.phone}</span>
                                  </label>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Loading state */}
          {loading && (
            <div className="flex items-center justify-center py-20">
              <span className="text-[#7d8590] text-sm">Loading...</span>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
