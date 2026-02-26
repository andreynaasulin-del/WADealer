'use client'
import { useState, useRef, useEffect } from 'react'
import { api, type Campaign } from '@/lib/api'

interface Props {
  campaigns: Campaign[]
  onClose?: () => void
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

const QUICK_PROMPTS = [
  { icon: '📝', label: 'Шаблон рассылки', prompt: 'Помоги составить шаблон WhatsApp-сообщения для первого контакта с лидами. Мой бизнес: ' },
  { icon: '💬', label: 'Скрипт продаж', prompt: 'Составь скрипт продаж для WhatsApp переписки. Этапы: первое сообщение → ответ → дожим → сделка. Продукт: ' },
  { icon: '🎯', label: 'Критерии AI-Детектора', prompt: 'Помоги написать критерии для AI-Детектора лидов (HOT/WARM/COLD). Мой идеальный клиент: ' },
  { icon: '📊', label: 'A/B тест', prompt: 'Предложи 3 варианта Spintax-шаблона для A/B теста. Ниша: ' },
]

export default function AIChat({ campaigns, onClose }: Props) {
  const [messages, setMessages]     = useState<Message[]>([])
  const [input, setInput]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [campaignCtx, setCampaignCtx] = useState<string>('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  // Build context from selected campaign
  const contextString = campaignCtx
    ? (() => {
        const c = campaigns.find(x => x.id === campaignCtx)
        if (!c) return ''
        return `Кампания: "${c.name}"\nШаблон: ${c.template_text}\nAI-критерии: ${c.ai_criteria || 'не заданы'}\nСтатус: ${c.status}\nОтправлено: ${c.total_sent}/${c.total_leads}`
      })()
    : ''

  async function sendMessage(text?: string) {
    const content = (text || input).trim()
    if (!content || loading) return

    const userMsg: Message = {
      id: `u_${Date.now()}`,
      role: 'user',
      content,
      timestamp: new Date(),
    }

    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)
    setError(null)

    try {
      // Build history for API (last 20 messages for context)
      const history = [...messages, userMsg]
        .slice(-20)
        .map(m => ({ role: m.role, content: m.content }))

      const res = await api.ai.chat(history, contextString || undefined)

      const aiMsg: Message = {
        id: `a_${Date.now()}`,
        role: 'assistant',
        content: res.reply,
        timestamp: new Date(),
      }

      setMessages(prev => [...prev, aiMsg])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка AI')
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function clearChat() {
    setMessages([])
    setError(null)
  }

  // Format message content with basic markdown-like rendering
  function renderContent(content: string) {
    // Split by code blocks first
    const parts = content.split(/(```[\s\S]*?```)/g)
    return parts.map((part, i) => {
      if (part.startsWith('```')) {
        const code = part.replace(/```\w*\n?/, '').replace(/```$/, '')
        return (
          <pre key={i} className="bg-[#0d1117] border border-[#30363d] rounded px-3 py-2 text-[11px] overflow-x-auto my-1.5 whitespace-pre-wrap">
            <code>{code}</code>
          </pre>
        )
      }
      // Bold **text**
      const withBold = part.split(/(\*\*[^*]+\*\*)/g).map((seg, j) => {
        if (seg.startsWith('**') && seg.endsWith('**')) {
          return <strong key={j} className="text-[#e6edf3] font-bold">{seg.slice(2, -2)}</strong>
        }
        return seg
      })
      return <span key={i}>{withBold}</span>
    })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#30363d] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-purple-400 font-bold text-xs tracking-wider uppercase">
            🤖 AI-Ассистент
          </span>
          <span className="text-purple-500 text-[9px] bg-purple-950/30 border border-purple-900/50 rounded px-1.5 py-0.5">
            GPT-4o-mini
          </span>
        </div>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button
              onClick={clearChat}
              className="text-[10px] text-[#7d8590] hover:text-red-400 cursor-pointer transition-colors"
              title="Очистить чат"
            >
              🗑 Очистить
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="text-[#7d8590] hover:text-[#e6edf3] cursor-pointer text-sm"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Campaign context selector */}
      <div className="px-3 py-1.5 border-b border-[#21262d] bg-[#0d1117]/50 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[#7d8590] text-[10px] shrink-0">Контекст:</span>
          <select
            className="flex-1 bg-transparent border border-[#30363d] rounded px-2 py-0.5 text-[10px] text-[#e6edf3]
                       focus:outline-none focus:border-purple-500 cursor-pointer"
            value={campaignCtx}
            onChange={e => setCampaignCtx(e.target.value)}
          >
            <option value="">Без кампании</option>
            {campaigns.map(c => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.total_leads} лидов)
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Messages area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3 min-h-0"
      >
        {/* Welcome message when empty */}
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-4 py-6 flex-1">
            <div className="text-center">
              <p className="text-[#7d8590] text-xs mb-1">Привет! Я твой AI-помощник для рассылок.</p>
              <p className="text-[#484f58] text-[10px]">
                Помогу составить шаблоны, стратегию и скрипты продаж
              </p>
            </div>

            {/* Quick prompts */}
            <div className="grid grid-cols-2 gap-1.5 w-full max-w-sm">
              {QUICK_PROMPTS.map((qp, i) => (
                <button
                  key={i}
                  onClick={() => setInput(qp.prompt)}
                  className="flex items-center gap-1.5 bg-[#0d1117] border border-[#30363d] rounded-lg px-2.5 py-2
                             hover:border-purple-700/50 hover:bg-purple-950/10 transition-all cursor-pointer text-left"
                >
                  <span className="text-sm">{qp.icon}</span>
                  <span className="text-[10px] text-[#e6edf3]">{qp.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Chat messages */}
        {messages.map(msg => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-green-900/30 border border-green-800/40 text-[#e6edf3]'
                  : 'bg-[#0d1117] border border-[#30363d] text-[#e6edf3]'
              }`}
            >
              {msg.role === 'assistant' ? (
                <div className="flex flex-col gap-1">
                  <span className="text-purple-400 text-[9px] font-bold uppercase tracking-wider">AI</span>
                  <div>{renderContent(msg.content)}</div>
                </div>
              ) : (
                <div>{msg.content}</div>
              )}
              <div className={`text-[8px] mt-1 ${msg.role === 'user' ? 'text-green-700' : 'text-[#484f58]'}`}>
                {msg.timestamp.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2">
              <div className="flex items-center gap-1">
                <span className="text-purple-400 text-[9px] font-bold">AI</span>
                <span className="flex gap-0.5">
                  <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="px-3 py-1.5 shrink-0">
          <p className="text-red-400 text-[10px] bg-red-950/20 border border-red-900/50 rounded px-2 py-1">
            ✗ {error}
          </p>
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-[#30363d] px-3 py-2 shrink-0 bg-[#161b22]">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            rows={2}
            className="flex-1 bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-xs text-[#e6edf3]
                       placeholder-[#484f58] focus:outline-none focus:border-purple-500 transition-colors resize-none
                       leading-relaxed"
            placeholder="Спроси что-нибудь: шаблон, стратегия, скрипт продаж..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
          <button
            onClick={() => sendMessage()}
            disabled={loading || !input.trim()}
            className="bg-purple-700 hover:bg-purple-600 disabled:bg-[#21262d] disabled:text-[#484f58]
                       text-white font-bold text-xs rounded-lg px-4 py-2 transition-colors cursor-pointer
                       disabled:cursor-not-allowed self-end shrink-0"
          >
            {loading ? '...' : '✈'}
          </button>
        </div>
        <p className="text-[8px] text-[#484f58] mt-1 text-center">
          Enter — отправить, Shift+Enter — новая строка
        </p>
      </div>
    </div>
  )
}
