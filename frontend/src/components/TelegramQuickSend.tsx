'use client'
import { useState } from 'react'
import { api, type TelegramAccount } from '@/lib/api'

interface Props {
  accounts: TelegramAccount[]
  selectedAccountId: string | null
  onStatsRefresh: () => void
}

export default function TelegramQuickSend({ accounts, selectedAccountId, onStatsRefresh }: Props) {
  const [chatId, setChatId] = useState('')
  const [text, setText]     = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const selectedAccount = accounts.find(a => a.id === selectedAccountId)
  const isActive = selectedAccount?.status === 'active'

  async function send() {
    if (!chatId.trim() || !text.trim() || !selectedAccountId || !isActive) return
    setSending(true); setResult(null)
    try {
      await api.telegram.accounts.send(selectedAccountId, chatId.trim(), text.trim())
      setResult({ ok: true, msg: `✓ Отправлено в ${chatId.trim()} через ${selectedAccount?.username ? '@' + selectedAccount.username : selectedAccount?.phone || 'аккаунт'}` })
      setChatId('')
      setText('')
      onStatsRefresh()
    } catch (e: unknown) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : 'Ошибка отправки' })
    } finally {
      setSending(false)
    }
  }

  if (!selectedAccountId) {
    return (
      <section className="flex flex-col gap-2 items-center justify-center py-6">
        <span className="text-zinc-700 text-xs">← Выбери аккаунт слева</span>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-2">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-blue-400 font-bold tracking-widest uppercase text-xs">▸</span>
        <span className="text-blue-400 font-bold text-xs">✈ Быстрая отправка</span>
        <span className="text-zinc-500 text-[10px] bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 font-mono">
          {selectedAccount?.username ? `@${selectedAccount.username}` : selectedAccount?.phone || '—'}
        </span>
        {!isActive && (
          <span className="text-red-400 text-[10px] font-bold">● Аккаунт не активен</span>
        )}
      </div>

      {/* Inputs */}
      <div className="flex gap-2">
        <input
          className="w-40 bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-200
                     placeholder-zinc-600 focus:outline-none focus:border-blue-500 transition-colors"
          placeholder="Chat ID / @username"
          value={chatId}
          onChange={e => setChatId(e.target.value)}
        />
        <input
          className="flex-1 min-w-0 bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-200
                     placeholder-zinc-600 focus:outline-none focus:border-blue-500 transition-colors"
          placeholder="Текст сообщения"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !sending && chatId && text && send()}
        />
        <button
          onClick={send}
          disabled={sending || !chatId || !text || !isActive}
          className="bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600
                     text-white font-bold text-xs rounded px-4 py-1.5 transition-colors cursor-pointer
                     disabled:cursor-not-allowed whitespace-nowrap"
        >
          {sending ? '...' : '✈ Отправить'}
        </button>
      </div>

      {result && (
        <p className={`text-xs rounded px-2 py-1 ${
          result.ok
            ? 'text-blue-400 bg-blue-950/20 border border-blue-900/50'
            : 'text-red-400 bg-red-950/20 border border-red-900/50'
        }`}>
          {result.msg}
        </p>
      )}
    </section>
  )
}
