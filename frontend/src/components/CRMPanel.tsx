'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { api, type Conversation, type WaMessage, type Session } from '@/lib/api'

interface Props {
  sessions: Session[]
  selectedPhone: string | null
  onClose: () => void
}

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)}с`
  if (diff < 3600) return `${Math.floor(diff / 60)}м`
  if (diff < 86400) return `${Math.floor(diff / 3600)}ч`
  return `${Math.floor(diff / 86400)}д`
}

export default function CRMPanel({ sessions, selectedPhone, onClose }: Props) {
  const [conversations, setConversations]       = useState<Conversation[]>([])
  const [selectedContact, setSelectedContact]   = useState<string | null>(null)
  const [messages, setMessages]                 = useState<WaMessage[]>([])
  const [replyText, setReplyText]               = useState('')
  const [sending, setSending]                   = useState(false)
  const [loadingMsgs, setLoadingMsgs]           = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  const loadConversations = useCallback(async () => {
    try { setConversations(await api.crm.conversations()) } catch (_) {}
  }, [])

  useEffect(() => {
    loadConversations()
    const t = setInterval(loadConversations, 15_000)
    return () => clearInterval(t)
  }, [loadConversations])

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
      await api.crm.send(selectedContact, replyText.trim(), selectedPhone || undefined)
      setReplyText('')
      await loadMessages(selectedContact)
      loadConversations()
    } catch (_) {}
    setSending(false)
  }

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#30363d] shrink-0 bg-[#161b22]">
        <div className="flex items-center gap-2">
          <span className="text-green-400 font-bold tracking-widest uppercase text-xs">💬 CRM</span>
          <span className="text-[#7d8590] text-[10px] bg-[#21262d] border border-[#30363d] rounded px-1.5 py-0.5">
            {conversations.length} диалогов
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-[#7d8590] hover:text-red-400 text-xs cursor-pointer px-1.5 py-0.5 rounded transition-colors hover:bg-red-950/20"
          title="Закрыть CRM"
        >
          ✕
        </button>
      </div>

      {/* Body — contact list above chat (vertical) */}
      <div className="flex flex-col flex-1 min-h-0">

        {/* Contact list */}
        <div className="shrink-0 border-b border-[#30363d] overflow-y-auto" style={{ maxHeight: '40%' }}>
          <div className="px-2 py-1.5 border-b border-[#30363d] bg-[#0d1117]">
            <span className="text-[#7d8590] text-[10px] uppercase tracking-wider">Контакты</span>
          </div>
          {conversations.length === 0 ? (
            <p className="text-[#484f58] text-[10px] px-3 py-4 text-center">Нет диалогов</p>
          ) : (
            conversations.map(conv => (
              <button
                key={conv.remote_phone}
                onClick={() => setSelectedContact(conv.remote_phone)}
                className={`w-full text-left px-3 py-2 border-b border-[#21262d] transition-colors cursor-pointer ${
                  selectedContact === conv.remote_phone
                    ? 'bg-green-950/30 border-l-2 border-l-green-500'
                    : 'hover:bg-[#161b22] border-l-2 border-l-transparent'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[#e6edf3] text-[11px] font-mono truncate">{conv.remote_phone}</span>
                  <span className="text-[#484f58] text-[9px] shrink-0 ml-1">{timeAgo(conv.last_message_at)}</span>
                </div>
                <p className="text-[#7d8590] text-[10px] truncate mt-0.5">
                  {conv.last_direction === 'inbound' ? '← ' : '→ '}{conv.last_message}
                </p>
              </button>
            ))
          )}
        </div>

        {/* Chat area */}
        <div className="flex-1 flex flex-col min-h-0">
          {!selectedContact ? (
            <div className="flex-1 flex items-center justify-center">
              <span className="text-[#484f58] text-xs text-center px-4">↑ Выберите контакт</span>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div className="px-3 py-2 border-b border-[#30363d] shrink-0 bg-[#161b22]">
                <span className="text-[#e6edf3] text-xs font-mono">{selectedContact}</span>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-2 min-h-0">
                {loadingMsgs ? (
                  <p className="text-[#484f58] text-[10px] text-center py-4">Загрузка...</p>
                ) : messages.length === 0 ? (
                  <p className="text-[#484f58] text-[10px] text-center py-4">Нет сообщений</p>
                ) : (
                  messages.map(msg => (
                    <div key={msg.id} className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] px-2.5 py-1.5 rounded-lg text-[11px] leading-relaxed ${
                        msg.direction === 'outbound'
                          ? 'bg-green-900/30 text-green-200 border border-green-800/40'
                          : 'bg-[#21262d] text-[#e6edf3] border border-[#30363d]'
                      }`}>
                        <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                        <p className={`text-[9px] mt-0.5 ${msg.direction === 'outbound' ? 'text-green-600' : 'text-[#484f58]'}`}>
                          {new Date(msg.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  ))
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Reply input */}
              <div className="border-t border-[#30363d] px-2 py-2 flex gap-2 shrink-0 bg-[#161b22]">
                <input
                  className="flex-1 min-w-0 bg-[#0d1117] border border-[#30363d] rounded px-2.5 py-1.5 text-xs text-[#e6edf3]
                             placeholder-[#7d8590] focus:outline-none focus:border-green-500 transition-colors"
                  placeholder="Введите ответ..."
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !sending && sendReply()}
                />
                <button
                  onClick={sendReply}
                  disabled={sending || !replyText.trim()}
                  className="bg-green-700 hover:bg-green-600 disabled:bg-[#21262d] disabled:text-[#484f58]
                             text-white font-bold text-xs rounded px-3 py-1.5 transition-colors cursor-pointer
                             disabled:cursor-not-allowed"
                >
                  {sending ? '...' : '→'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
