'use client'
import { useEffect, useRef, useState } from 'react'

export interface LogEntry {
  type: 'log'
  session: string
  message: string
  level: 'info' | 'warn' | 'error' | 'system'
  ts: string
}

interface Props {
  entries: LogEntry[]
  onClear: () => void
  selectedPhone: string | null
}

const levelClass: Record<string, string> = {
  info:   'log-line-info',
  warn:   'log-line-warn',
  error:  'log-line-error',
  system: 'log-line-system',
}

const levelPrefix: Record<string, string> = {
  info:   '  ',
  warn:   '⚠ ',
  error:  '✗ ',
  system: '● ',
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('ru-RU', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function maskPhone(session: string) {
  if (!session || session === 'SYSTEM') return 'СИС'
  if (session.length > 8) return session.slice(0, 5) + '..' + session.slice(-3)
  return session
}

export default function LiveLogs({ entries, onClear, selectedPhone }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [filterMode, setFilterMode] = useState<'all' | 'session'>('session')

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries])

  // Filter entries based on mode
  const filteredEntries = filterMode === 'session' && selectedPhone
    ? entries.filter(e => e.session === selectedPhone || e.session === 'SYSTEM')
    : entries

  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-green-400 font-bold tracking-widest uppercase text-xs">
            ▸ Логи
          </span>
          {/* Filter toggle */}
          {selectedPhone && (
            <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded overflow-hidden">
              <button
                onClick={() => setFilterMode('session')}
                className={`text-[10px] px-2 py-0.5 transition-colors cursor-pointer ${
                  filterMode === 'session'
                    ? 'bg-green-900/40 text-green-400 font-bold'
                    : 'text-zinc-600 hover:text-zinc-400'
                }`}
              >
                Сессия
              </button>
              <button
                onClick={() => setFilterMode('all')}
                className={`text-[10px] px-2 py-0.5 transition-colors cursor-pointer ${
                  filterMode === 'all'
                    ? 'bg-zinc-700 text-zinc-200 font-bold'
                    : 'text-zinc-600 hover:text-zinc-400'
                }`}
              >
                Все
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-zinc-700 text-xs">
            {filteredEntries.length}{filterMode === 'session' && entries.length !== filteredEntries.length ? `/${entries.length}` : ''} записей
          </span>
          <button
            onClick={onClear}
            className="text-zinc-600 hover:text-zinc-400 text-xs cursor-pointer transition-colors"
          >
            очистить
          </button>
        </div>
      </div>

      {/* Terminal */}
      <div className="bg-zinc-950 border border-zinc-800 rounded p-3 h-36 overflow-y-auto font-mono text-[11px]
                      relative">
        {/* Scan line effect */}
        <div className="absolute inset-0 pointer-events-none"
             style={{ background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px)' }}
        />

        {filteredEntries.length === 0 && (
          <span className="text-zinc-700">
            {filterMode === 'session' && selectedPhone
              ? `Нет логов для этой сессии. Переключи на «Все» чтобы увидеть всё.`
              : 'Ожидание событий... Подключись к бэкенду через WebSocket.'
            }
          </span>
        )}

        {filteredEntries.map((e, i) => (
          <div key={i} className={`${levelClass[e.level] || 'log-line-info'} leading-4 whitespace-pre-wrap break-all`}>
            <span className="text-zinc-700 select-none">[{formatTime(e.ts)}]</span>
            <span className="text-zinc-600 select-none">[{maskPhone(e.session)}]</span>
            <span> {levelPrefix[e.level]}{e.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </section>
  )
}
