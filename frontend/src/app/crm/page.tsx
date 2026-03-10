'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { api, type Conversation, type WaMessage, type Session, type Campaign } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)}с назад`
  if (diff < 3600) return `${Math.floor(diff / 60)}м назад`
  if (diff < 86400) return `${Math.floor(diff / 3600)}ч назад`
  return `${Math.floor(diff / 86400)}д назад`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

export default function CRMPage() {
  const { isAuthenticated, isLoading } = useAuth()
  const router = useRouter()

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedContact, setSelectedContact] = useState<string | null>(null)
  const [messages, setMessages] = useState<WaMessage[]>([])
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [search, setSearch] = useState('')
  const [filterDir, setFilterDir] = useState<'all' | 'inbound' | 'outbound'>('all')
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [filterCampaign, setFilterCampaign] = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.push('/login')
  }, [isAuthenticated, isLoading, router])

  const loadConversations = useCallback(async () => {
    try { setConversations(await api.crm.conversations(filterCampaign || undefined)) } catch (_) {}
  }, [filterCampaign])

  const loadSessions = useCallback(async () => {
    try { setSessions(await api.sessions.list()) } catch (_) {}
  }, [])

  const loadCampaigns = useCallback(async () => {
    try { setCampaigns(await api.campaigns.list()) } catch (_) {}
  }, [])

  useEffect(() => {
    if (!isAuthenticated) return
    loadConversations()
    loadSessions()
    loadCampaigns()
    const t = setInterval(loadConversations, 10_000)
    return () => clearInterval(t)
  }, [isAuthenticated, loadConversations, loadSessions, loadCampaigns])

  const loadMessages = useCallback(async (phone: string) => {
    setLoadingMsgs(true)
    try { setMessages(await api.crm.messages(phone, 100)) } catch (_) {}
    setLoadingMsgs(false)
  }, [])

  useEffect(() => {
    if (selectedContact) loadMessages(selectedContact)
  }, [selectedContact, loadMessages])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendReply() {
    if (!replyText.trim() || !selectedContact || sending) return
    setSending(true)
    try {
      const onlineSession = sessions.find(s => s.status === 'online')
      await api.crm.send(selectedContact, replyText.trim(), onlineSession?.phone)
      setReplyText('')
      await loadMessages(selectedContact)
      loadConversations()
    } catch (_) {}
    setSending(false)
  }

  const filtered = conversations.filter(c => {
    const matchSearch = !search || c.remote_phone.includes(search) || c.last_message?.toLowerCase().includes(search.toLowerCase())
    const matchDir = filterDir === 'all' || c.last_direction === filterDir
    return matchSearch && matchDir
  })

  const inboundCount = conversations.filter(c => c.last_direction === 'inbound').length
  const onlineSession = sessions.find(s => s.status === 'online')

  if (isLoading) {
    return (
      <div className="h-screen bg-[#0d1117] flex items-center justify-center">
        <span className="text-green-400 text-sm animate-pulse">Загрузка...</span>
      </div>
    )
  }

  return (
    <div className="h-screen bg-[#0d1117] text-[#e6edf3] flex flex-col overflow-hidden" style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>

      {/* Top nav */}
      <div className="shrink-0 border-b border-[#30363d] bg-[#161b22] px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/whatsapp')}
            className="text-[#7d8590] hover:text-green-400 text-xs transition-colors cursor-pointer"
          >
            ← Меню
          </button>
          <span className="text-[#30363d]">|</span>
          <span className="text-green-400 font-bold tracking-widest uppercase text-xs">💬 CRM</span>
          <span className="text-[#484f58] text-[10px]">Диалоги с лидами</span>
        </div>
        <div className="flex items-center gap-3">
          {onlineSession && (
            <span className="text-[10px] text-green-400 bg-green-950/30 border border-green-800/40 rounded px-2 py-0.5">
              ● {onlineSession.phone}
            </span>
          )}
          <span className="text-[10px] text-[#7d8590] bg-[#21262d] border border-[#30363d] rounded px-2 py-0.5">
            {conversations.length} всего
          </span>
          {inboundCount > 0 && (
            <span className="text-[10px] text-yellow-400 bg-yellow-950/30 border border-yellow-800/40 rounded px-2 py-0.5">
              ↙ {inboundCount} ответили
            </span>
          )}
        </div>
      </div>

      {/* Main layout */}
      <div className="flex flex-1 min-h-0">

        {/* Left sidebar — conversation list */}
        <div className="w-72 shrink-0 border-r border-[#30363d] flex flex-col bg-[#0d1117]">

          {/* Search + filter */}
          <div className="shrink-0 border-b border-[#30363d] p-2 space-y-2">
            <input
              className="w-full bg-[#161b22] border border-[#30363d] rounded px-2.5 py-1.5 text-[11px] text-[#e6edf3]
                         placeholder-[#484f58] focus:outline-none focus:border-green-500 transition-colors"
              placeholder="Поиск по номеру или тексту..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <div className="flex gap-1">
              {(['all', 'inbound', 'outbound'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilterDir(f)}
                  className={`flex-1 text-[9px] uppercase tracking-wide rounded px-1 py-1 transition-colors cursor-pointer ${
                    filterDir === f
                      ? 'bg-green-800/40 text-green-400 border border-green-700/40'
                      : 'bg-[#161b22] text-[#484f58] border border-[#30363d] hover:text-[#7d8590]'
                  }`}
                >
                  {f === 'all' ? 'Все' : f === 'inbound' ? '↙ Входящие' : '↗ Исходящие'}
                </button>
              ))}
            </div>
            {campaigns.length > 0 && (
              <select
                value={filterCampaign}
                onChange={e => { setFilterCampaign(e.target.value); setSelectedContact(null) }}
                className="w-full bg-[#161b22] border border-[#30363d] rounded px-2 py-1 text-[10px] text-[#e6edf3]
                           focus:outline-none focus:border-green-500 transition-colors"
              >
                <option value="">Все кампании</option>
                {campaigns.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.total_leads} лидов)
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Contact list */}
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4">
                <span className="text-3xl opacity-20">💬</span>
                <p className="text-[#484f58] text-[11px]">
                  {conversations.length === 0
                    ? 'Диалогов ещё нет.\nДождитесь ответов на кампанию.'
                    : 'Ничего не найдено'}
                </p>
              </div>
            ) : (
              filtered.map(conv => {
                const isSelected = selectedContact === conv.remote_phone
                const isInbound = conv.last_direction === 'inbound'
                return (
                  <button
                    key={conv.remote_phone}
                    onClick={() => setSelectedContact(conv.remote_phone)}
                    className={`w-full text-left px-3 py-2.5 border-b border-[#161b22] transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-green-950/30 border-l-2 border-l-green-500'
                        : 'hover:bg-[#161b22] border-l-2 ' + (isInbound ? 'border-l-yellow-600/50' : 'border-l-transparent')
                    }`}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[11px] font-mono text-[#e6edf3] truncate">{conv.remote_phone}</span>
                      <span className="text-[9px] text-[#484f58] shrink-0 ml-1">{timeAgo(conv.last_message_at)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className={`text-[9px] shrink-0 ${isInbound ? 'text-yellow-500' : 'text-[#484f58]'}`}>
                        {isInbound ? '↙' : '↗'}
                      </span>
                      <p className="text-[10px] text-[#7d8590] truncate">{conv.last_message}</p>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Right — chat area */}
        <div className="flex-1 flex flex-col min-w-0">
          {!selectedContact ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
              <span className="text-5xl opacity-10">💬</span>
              <div>
                <p className="text-[#7d8590] text-sm">Выберите диалог</p>
                <p className="text-[#484f58] text-xs mt-1">
                  {conversations.length === 0
                    ? 'Кампания запущена. Ответы появятся здесь.'
                    : `${conversations.length} диалогов — выберите контакт`}
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div className="shrink-0 border-b border-[#30363d] bg-[#161b22] px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-green-900/40 border border-green-700/40 flex items-center justify-center text-xs text-green-400">
                    {selectedContact.slice(-2)}
                  </div>
                  <div>
                    <p className="text-[#e6edf3] text-sm font-mono">{selectedContact}</p>
                    <p className="text-[#484f58] text-[10px]">{messages.length} сообщений</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <a
                    href={`https://wa.me/${selectedContact.replace('+', '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-green-400 bg-green-950/30 border border-green-800/40 rounded px-2 py-1 hover:bg-green-900/40 transition-colors"
                  >
                    Открыть в WA ↗
                  </a>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-2 min-h-0">
                {loadingMsgs ? (
                  <div className="flex-1 flex items-center justify-center">
                    <span className="text-[#484f58] text-xs animate-pulse">Загрузка сообщений...</span>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center">
                    <span className="text-[#484f58] text-xs">Нет сообщений</span>
                  </div>
                ) : (
                  messages.map((msg, i) => {
                    const prevMsg = messages[i - 1]
                    const showDate = !prevMsg || formatDate(msg.created_at) !== formatDate(prevMsg.created_at)
                    const isOut = msg.direction === 'outbound'

                    const mediaMatch = msg.body?.match(/^\[media:(image|video|audio|document|sticker):(.+?)\]([\s\S]*)$/)
                    const isMedia = !!mediaMatch
                    const mediaType = mediaMatch?.[1]
                    const mediaUrl = mediaMatch?.[2]
                    const caption = mediaMatch?.[3]?.trim()

                    return (
                      <div key={msg.id}>
                        {showDate && (
                          <div className="flex items-center gap-2 my-3">
                            <div className="flex-1 h-px bg-[#21262d]" />
                            <span className="text-[#484f58] text-[9px] uppercase tracking-wide">{formatDate(msg.created_at)}</span>
                            <div className="flex-1 h-px bg-[#21262d]" />
                          </div>
                        )}
                        <div className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[70%] px-3 py-2 rounded-xl text-[12px] leading-relaxed ${
                            isOut
                              ? 'bg-green-900/30 text-green-100 border border-green-800/30 rounded-br-sm'
                              : 'bg-[#21262d] text-[#e6edf3] border border-[#30363d] rounded-bl-sm'
                          }`}>
                            {isMedia && mediaUrl ? (
                              <>
                                {(mediaType === 'image' || mediaType === 'sticker') ? (
                                  <a href={mediaUrl} target="_blank" rel="noopener noreferrer">
                                    <img src={mediaUrl} alt="📷" className="max-w-[250px] max-h-[250px] rounded object-cover mb-1 cursor-pointer hover:opacity-80 transition-opacity" loading="lazy" />
                                  </a>
                                ) : mediaType === 'video' ? (
                                  <video src={mediaUrl} controls className="max-w-[250px] max-h-[250px] rounded mb-1" />
                                ) : mediaType === 'audio' ? (
                                  <audio src={mediaUrl} controls className="mb-1" />
                                ) : (
                                  <a href={mediaUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">📎 Документ</a>
                                )}
                                {caption && <p className="whitespace-pre-wrap break-words">{caption}</p>}
                              </>
                            ) : (
                              <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                            )}
                            <p className={`text-[9px] mt-1 text-right ${isOut ? 'text-green-600' : 'text-[#484f58]'}`}>
                              {formatTime(msg.created_at)}
                            </p>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Reply input */}
              <div className="shrink-0 border-t border-[#30363d] bg-[#161b22] px-4 py-3">
                <div className="flex gap-2">
                  <input
                    className="flex-1 min-w-0 bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-[#e6edf3]
                               placeholder-[#484f58] focus:outline-none focus:border-green-500 transition-colors"
                    placeholder={`Ответить ${selectedContact}...`}
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && !sending && sendReply()}
                  />
                  <button
                    onClick={sendReply}
                    disabled={sending || !replyText.trim()}
                    className="bg-green-700 hover:bg-green-600 disabled:bg-[#21262d] disabled:text-[#484f58]
                               text-white font-bold text-sm rounded-lg px-4 py-2 transition-colors cursor-pointer
                               disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    {sending ? '...' : 'Отправить →'}
                  </button>
                </div>
                {onlineSession && (
                  <p className="text-[#484f58] text-[9px] mt-1">Отправка через {onlineSession.phone}</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
