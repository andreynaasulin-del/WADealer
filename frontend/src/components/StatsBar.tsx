'use client'
import type { Stats } from '@/lib/api'

interface Props {
  stats: Stats | null
  queueStatus: string
}

function Chip({
  label, value, color = 'text-[#e6edf3]',
}: { label: string; value: string | number; color?: string }) {
  return (
    <div className="flex items-center gap-1.5 sm:gap-2 bg-[#161b22] border border-[#30363d] rounded px-2 sm:px-3 py-1 sm:py-1.5 shrink-0">
      <span className={`text-xs sm:text-sm font-bold tabular-nums ${color}`}>{value}</span>
      <span className="text-[#7d8590] text-[9px] sm:text-[10px] uppercase tracking-wider whitespace-nowrap">{label}</span>
    </div>
  )
}

const QUEUE_COLOR: Record<string, string> = {
  running: 'text-green-400',
  paused:  'text-yellow-400',
  stopped: 'text-zinc-500',
}

const QUEUE_LABEL: Record<string, string> = {
  running: '▶ РАБОТАЕТ',
  paused:  '⏸ ПАУЗА',
  stopped: '⏹ СТОП',
}

export default function StatsBar({ stats, queueStatus }: Props) {
  if (!stats) {
    return (
      <div className="flex gap-2 flex-wrap">
        {[...Array(7)].map((_, i) => (
          <div key={i} className="bg-[#161b22] border border-[#30363d] rounded px-3 py-1.5 w-24 h-8 animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex gap-1.5 sm:gap-2 items-center shrink-0 overflow-x-auto pb-1 scrollbar-thin">
      <Chip label="В сети"       value={stats.sessions_online}  color="text-green-400" />
      <Chip label="Не в сети"    value={stats.sessions_offline} color="text-zinc-500" />
      <Chip label="Заблокир."    value={stats.sessions_banned}  color="text-red-400" />
      <div className="w-px h-6 bg-[#30363d] shrink-0 hidden sm:block" />
      <Chip label="Отправлено"   value={stats.sent_today}  color="text-green-400" />
      <Chip label="Очередь"      value={stats.in_queue}    color="text-blue-400" />
      <Chip label="Ошибки"       value={stats.errors}      color="text-red-400" />
      <div className="w-px h-6 bg-[#30363d] shrink-0 hidden sm:block" />
      <div className="bg-[#161b22] border border-[#30363d] rounded px-2 sm:px-3 py-1 sm:py-1.5 shrink-0">
        <span className={`text-[10px] sm:text-xs font-bold uppercase tracking-wide ${QUEUE_COLOR[queueStatus] || 'text-zinc-500'}`}>
          {QUEUE_LABEL[queueStatus] || '⏹ СТОП'}
        </span>
      </div>
    </div>
  )
}
