'use client'
import { useState, useEffect, useCallback } from 'react'
import { api, type AccountSettings, type TelegramAccount } from '@/lib/api'

interface Props {
  account: TelegramAccount
  onClose: () => void
  onUpdate: () => void
}

export default function AccountSettingsPanel({ account, onClose, onUpdate }: Props) {
  const [settings, setSettings] = useState<AccountSettings | null>(null)
  const [proxy, setProxy] = useState(account.proxyString || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const loadSettings = useCallback(async () => {
    try {
      const data = await api.telegram.settings.get(account.id)
      setSettings(data)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [account.id])

  useEffect(() => { loadSettings() }, [loadSettings])

  async function saveSettings() {
    if (!settings) return
    setSaving(true)
    setError(null)
    try {
      await api.telegram.settings.update(account.id, settings)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 2000)
      onUpdate()
    } catch (err) {
      setError((err as Error).message)
    }
    setSaving(false)
  }

  async function saveProxy() {
    setSaving(true)
    setError(null)
    try {
      await api.telegram.settings.updateProxy(account.id, proxy || null)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 2000)
      onUpdate()
    } catch (err) {
      setError((err as Error).message)
    }
    setSaving(false)
  }

  if (!settings) {
    return (
      <div className="bg-zinc-900/80 border border-zinc-700 rounded-xl p-5">
        <div className="text-zinc-600 text-sm">Загрузка настроек...</div>
      </div>
    )
  }

  return (
    <div className="bg-zinc-900/80 border border-zinc-700 rounded-xl p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-zinc-200">
            Настройки: {account.username ? `@${account.username}` : account.phone}
          </h3>
          <p className="text-[10px] text-zinc-600 mt-0.5">
            Статус: <span className={account.status === 'active' ? 'text-green-400' : 'text-zinc-500'}>{account.status}</span>
          </p>
        </div>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-400 transition-colors cursor-pointer text-sm">
          ✕
        </button>
      </div>

      {error && (
        <div className="bg-red-950/30 border border-red-500/40 rounded px-3 py-2 text-red-400 text-xs">{error}</div>
      )}
      {success && (
        <div className="bg-green-950/30 border border-green-500/40 rounded px-3 py-2 text-green-400 text-xs">Сохранено!</div>
      )}

      {/* Proxy */}
      <div className="space-y-2">
        <label className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Прокси (SOCKS5)</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={proxy}
            onChange={e => setProxy(e.target.value)}
            placeholder="ip:port:user:pass"
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-blue-500/50 outline-none"
          />
          <button onClick={saveProxy} disabled={saving} className="bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white text-xs font-bold rounded px-3 py-1.5 cursor-pointer transition-colors">
            Сохранить
          </button>
        </div>
      </div>

      {/* Module toggles */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Inviting */}
        <ModuleCard
          title="Инвайтинг"
          description="Приглашение пользователей в каналы"
          enabled={settings.inviting.enabled}
          onToggle={() => setSettings({...settings, inviting: {...settings.inviting, enabled: !settings.inviting.enabled}})}
          color="blue"
        >
          <NumberInput label="Дневной лимит" value={settings.inviting.daily_limit} onChange={v => setSettings({...settings, inviting: {...settings.inviting, daily_limit: v}})} min={1} max={200} />
          <NumberInput label="Задержка мин (сек)" value={settings.inviting.delay_min} onChange={v => setSettings({...settings, inviting: {...settings.inviting, delay_min: v}})} min={5} max={600} />
          <NumberInput label="Задержка макс (сек)" value={settings.inviting.delay_max} onChange={v => setSettings({...settings, inviting: {...settings.inviting, delay_max: v}})} min={10} max={1200} />
        </ModuleCard>

        {/* Story Liking */}
        <ModuleCard
          title="Лайки сторис"
          description="Автоматические лайки историй"
          enabled={settings.story_liking.enabled}
          onToggle={() => setSettings({...settings, story_liking: {...settings.story_liking, enabled: !settings.story_liking.enabled}})}
          color="pink"
        >
          <NumberInput label="Интервал мин (сек)" value={settings.story_liking.interval_min} onChange={v => setSettings({...settings, story_liking: {...settings.story_liking, interval_min: v}})} min={60} max={7200} />
          <NumberInput label="Интервал макс (сек)" value={settings.story_liking.interval_max} onChange={v => setSettings({...settings, story_liking: {...settings.story_liking, interval_max: v}})} min={120} max={14400} />
          <NumberInput label="Вероятность (%)" value={Math.round(settings.story_liking.like_probability * 100)} onChange={v => setSettings({...settings, story_liking: {...settings.story_liking, like_probability: v / 100}})} min={10} max={100} />
        </ModuleCard>

        {/* Neuro Commenting */}
        <ModuleCard
          title="Нейрокомментинг"
          description="AI-генерация комментариев"
          enabled={settings.neuro_commenting.enabled}
          onToggle={() => setSettings({...settings, neuro_commenting: {...settings.neuro_commenting, enabled: !settings.neuro_commenting.enabled}})}
          color="purple"
        >
          <div className="space-y-1">
            <label className="text-[10px] text-zinc-500">AI модель</label>
            <select
              value={settings.neuro_commenting.ai_model}
              onChange={e => setSettings({...settings, neuro_commenting: {...settings.neuro_commenting, ai_model: e.target.value as 'grok' | 'claude' | 'gpt'}})}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 outline-none cursor-pointer"
            >
              <option value="grok">Grok</option>
              <option value="claude">Claude</option>
              <option value="gpt">GPT</option>
            </select>
          </div>
          <NumberInput label="Интервал мин (сек)" value={settings.neuro_commenting.comment_interval_min} onChange={v => setSettings({...settings, neuro_commenting: {...settings.neuro_commenting, comment_interval_min: v}})} min={120} max={7200} />
          <NumberInput label="Макс в день" value={settings.neuro_commenting.max_daily} onChange={v => setSettings({...settings, neuro_commenting: {...settings.neuro_commenting, max_daily: v}})} min={1} max={100} />
        </ModuleCard>

        {/* Mass DM */}
        <ModuleCard
          title="Массовая рассылка"
          description="Рассылка DM сообщений"
          enabled={settings.mass_dm.enabled}
          onToggle={() => setSettings({...settings, mass_dm: {...settings.mass_dm, enabled: !settings.mass_dm.enabled}})}
          color="green"
        >
          <NumberInput label="Дневной лимит" value={settings.mass_dm.daily_limit} onChange={v => setSettings({...settings, mass_dm: {...settings.mass_dm, daily_limit: v}})} min={1} max={200} />
          <NumberInput label="Задержка мин (сек)" value={settings.mass_dm.delay_min} onChange={v => setSettings({...settings, mass_dm: {...settings.mass_dm, delay_min: v}})} min={10} max={600} />
          <NumberInput label="Задержка макс (сек)" value={settings.mass_dm.delay_max} onChange={v => setSettings({...settings, mass_dm: {...settings.mass_dm, delay_max: v}})} min={30} max={1200} />
        </ModuleCard>
      </div>

      {/* Save button */}
      <div className="flex justify-end">
        <button
          onClick={saveSettings}
          disabled={saving}
          className="bg-green-600 hover:bg-green-500 disabled:bg-zinc-700 text-white font-bold text-sm rounded-lg px-6 py-2 cursor-pointer transition-colors"
        >
          {saving ? 'Сохранение...' : 'Сохранить настройки'}
        </button>
      </div>
    </div>
  )
}

function ModuleCard({ title, description, enabled, onToggle, color, children }: {
  title: string
  description: string
  enabled: boolean
  onToggle: () => void
  color: string
  children: React.ReactNode
}) {
  const borderColor: Record<string, string> = {
    blue: enabled ? 'border-blue-500/40' : 'border-zinc-800',
    pink: enabled ? 'border-pink-500/40' : 'border-zinc-800',
    purple: enabled ? 'border-purple-500/40' : 'border-zinc-800',
    green: enabled ? 'border-green-500/40' : 'border-zinc-800',
  }
  const dotColor: Record<string, string> = {
    blue: 'bg-blue-400',
    pink: 'bg-pink-400',
    purple: 'bg-purple-400',
    green: 'bg-green-400',
  }

  return (
    <div className={`bg-zinc-950/50 border ${borderColor[color]} rounded-lg p-4 transition-colors`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${enabled ? dotColor[color] : 'bg-zinc-700'}`} />
          <div>
            <span className="text-xs font-bold text-zinc-200">{title}</span>
            <p className="text-[10px] text-zinc-600">{description}</p>
          </div>
        </div>
        <button
          onClick={onToggle}
          className={`w-10 h-5 rounded-full transition-colors relative cursor-pointer ${enabled ? 'bg-green-500' : 'bg-zinc-700'}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${enabled ? 'left-5.5' : 'left-0.5'}`} />
        </button>
      </div>
      {enabled && (
        <div className="space-y-2 pt-2 border-t border-zinc-800">
          {children}
        </div>
      )}
    </div>
  )
}

function NumberInput({ label, value, onChange, min, max }: {
  label: string; value: number; onChange: (v: number) => void; min: number; max: number
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label className="text-[10px] text-zinc-500 shrink-0">{label}</label>
      <input
        type="number"
        value={value}
        onChange={e => {
          const v = parseInt(e.target.value)
          if (!isNaN(v) && v >= min && v <= max) onChange(v)
        }}
        min={min}
        max={max}
        className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-200 text-right outline-none focus:border-blue-500/50"
      />
    </div>
  )
}
