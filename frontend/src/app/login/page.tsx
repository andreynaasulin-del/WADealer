'use client'
import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'

const STORAGE_KEY = 'wa_dealer_auth_token'
const TG_BOT = (process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'wadealerbot').trim()
const POLL_INTERVAL = 2500
const POLL_TIMEOUT = 3 * 60 * 1000 // 3 minutes

type Tab = 'login' | 'register'
type BotAuthStatus = 'idle' | 'waiting' | 'error'

function generateState(): string {
  const arr = new Uint8Array(16)
  crypto.getRandomValues(arr)
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

export default function LoginPage() {
  const { login, register, isAuthenticated, isLoading } = useAuth()
  const [tab, setTab] = useState<Tab>('login')
  const [showEmailForm, setShowEmailForm] = useState(false)

  // Login form
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteToken, setInviteToken] = useState('')

  // Register form
  const [regEmail, setRegEmail] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regName, setRegName] = useState('')
  const [regInvite, setRegInvite] = useState('')

  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Bot deeplink polling
  const [botStatus, setBotStatus] = useState<BotAuthStatus>('idle')
  const [botStateKey, setBotStateKey] = useState('')
  const [pollSecondsLeft, setPollSecondsLeft] = useState(0)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const tgBotUrl = `https://t.me/${TG_BOT}`

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      window.location.href = '/'
    }
  }, [isAuthenticated, isLoading])

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      stopPolling()
    }
  }, [])

  function stopPolling() {
    if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null }
    if (pollTimeoutRef.current) { clearTimeout(pollTimeoutRef.current); pollTimeoutRef.current = null }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null }
  }

  function cancelBotAuth() {
    stopPolling()
    setBotStatus('idle')
    setBotStateKey('')
  }

  async function handleBotLogin() {
    const state = generateState()
    setBotStateKey(state)
    setBotStatus('waiting')
    setError('')

    const totalSecs = Math.floor(POLL_TIMEOUT / 1000)
    setPollSecondsLeft(totalSecs)

    // Open Telegram deep link
    window.open(`https://t.me/${TG_BOT}?start=web_${state}`, '_blank')

    // Countdown display
    countdownRef.current = setInterval(() => {
      setPollSecondsLeft(s => {
        if (s <= 1) { clearInterval(countdownRef.current!); return 0 }
        return s - 1
      })
    }, 1000)

    // Polling loop
    pollTimerRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/auth/tg-bot-poll?state=${state}`)
        const data = await res.json()
        if (data.ok && data.session_token) {
          stopPolling()
          localStorage.setItem(STORAGE_KEY, data.session_token)
          window.location.href = '/'
        }
      } catch { /* network errors — keep polling */ }
    }, POLL_INTERVAL)

    // Timeout
    pollTimeoutRef.current = setTimeout(() => {
      stopPolling()
      setBotStatus('error')
      setError('Время ожидания истекло. Попробуйте ещё раз.')
    }, POLL_TIMEOUT)
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    let result: { ok: boolean; error?: string }

    if (inviteToken.trim()) {
      result = await login(inviteToken.trim())
    } else if (email.trim() && password) {
      result = await login(undefined, email.trim(), password)
    } else {
      setError('Введите email + пароль или invite-код')
      setLoading(false)
      return
    }

    if (result.ok) {
      window.location.href = '/'
    } else {
      setError(result.error || 'Ошибка входа')
      setLoading(false)
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    if (!regEmail.trim() || !regPassword) {
      setError('Email и пароль обязательны')
      return
    }
    if (regPassword.length < 6) {
      setError('Пароль минимум 6 символов')
      return
    }
    setLoading(true)
    setError('')

    const result = await register(regEmail.trim(), regPassword, regName.trim() || undefined, regInvite.trim() || undefined)

    if (result.ok) {
      window.location.href = '/'
    } else {
      setError(result.error || 'Ошибка регистрации')
      setLoading(false)
    }
  }

  async function handleGoogleLogin() {
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/auth/callback' },
    })
    if (error) {
      setError(error.message)
      setLoading(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
          <div className="text-zinc-600 text-xs font-mono">Загрузка...</div>
        </div>
      </div>
    )
  }

  const inputClass = "w-full bg-white/5 border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-green-500/60 focus:bg-white/8 transition-all"

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 font-mono flex items-center justify-center p-4"
      style={{ background: 'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(16,185,129,0.08) 0%, transparent 60%), #09090b' }}>

      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-green-500/20 border border-green-500/30 flex items-center justify-center">
              <span className="text-green-400 text-sm font-bold">W</span>
            </div>
            <span className="text-white font-bold text-xl tracking-wider">WA DEALER</span>
          </div>
          <p className="text-zinc-500 text-xs">Мульти-сессия WhatsApp & Telegram рассылки</p>
        </div>

        {/* Main card */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl p-6 shadow-2xl">

          {/* Tabs */}
          <div className="flex mb-5 bg-white/5 rounded-xl p-1">
            {(['login', 'register'] as const).map(t => (
              <button
                key={t}
                onClick={() => { setTab(t); setError(''); setShowEmailForm(false); cancelBotAuth() }}
                className={`flex-1 py-2 text-xs font-bold tracking-wider rounded-lg transition-all cursor-pointer ${
                  tab === t
                    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {t === 'login' ? 'ВХОД' : 'РЕГИСТРАЦИЯ'}
              </button>
            ))}
          </div>

          {/* Error */}
          {error && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-4">
              {error}
            </div>
          )}

          {/* ── LOGIN TAB ─────────────────────────────────────────── */}
          {tab === 'login' && (
            <div className="flex flex-col gap-3">

              {/* Telegram Bot — primary CTA */}
              {botStatus !== 'waiting' ? (
                <button
                  onClick={handleBotLogin}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2.5 bg-[#229ED9] hover:bg-[#1a8abf] disabled:opacity-50
                             text-white font-bold text-sm rounded-xl px-4 py-3.5 transition-all cursor-pointer
                             disabled:cursor-not-allowed"
                >
                  <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/>
                  </svg>
                  Войти через Telegram
                </button>
              ) : (
                /* Waiting state */
                <div className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3.5">
                  <div className="flex items-center gap-2.5 mb-2.5">
                    <div className="w-3.5 h-3.5 border-2 border-[#229ED9] border-t-transparent rounded-full animate-spin flex-shrink-0" />
                    <span className="text-zinc-200 text-sm font-bold">Ожидаем подтверждение</span>
                    <span className="ml-auto text-zinc-600 text-xs tabular-nums">
                      {Math.floor(pollSecondsLeft / 60)}:{String(pollSecondsLeft % 60).padStart(2, '0')}
                    </span>
                  </div>
                  <p className="text-zinc-500 text-xs mb-3">
                    Нажмите <b className="text-zinc-300">Start</b> в боте <span className="text-[#229ED9]">@{TG_BOT}</span> — страница обновится сама.
                  </p>
                  <div className="flex gap-2">
                    <a
                      href={`https://t.me/${TG_BOT}?start=web_${botStateKey}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 text-center text-xs bg-[#229ED9]/20 hover:bg-[#229ED9]/30 text-[#229ED9] border border-[#229ED9]/30 rounded-lg py-1.5 transition-colors cursor-pointer"
                    >
                      Открыть бота
                    </a>
                    <button
                      onClick={cancelBotAuth}
                      className="flex-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-lg py-1.5 transition-colors cursor-pointer"
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              )}

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-white/8" />
                <span className="text-[10px] text-zinc-700">или</span>
                <div className="flex-1 h-px bg-white/8" />
              </div>

              {/* Google */}
              {isSupabaseConfigured && (
                <button
                  onClick={handleGoogleLogin}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2.5 bg-white/5 hover:bg-white/10 disabled:opacity-50
                             border border-white/10 text-zinc-200 font-medium text-sm rounded-xl px-4 py-2.5
                             transition-all cursor-pointer disabled:cursor-not-allowed"
                >
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Google
                </button>
              )}

              {/* Email toggle */}
              <button
                onClick={() => setShowEmailForm(v => !v)}
                className="text-xs text-zinc-600 hover:text-zinc-400 cursor-pointer transition-colors text-center"
              >
                {showEmailForm ? '▲ Скрыть' : '▼ Email / invite-код'}
              </button>

              {/* Email form — collapsible */}
              {showEmailForm && (
                <form onSubmit={handleLogin} className="flex flex-col gap-3 pt-1">
                  <input
                    type="email"
                    value={email}
                    onChange={e => { setEmail(e.target.value); setError('') }}
                    placeholder="Email"
                    className={inputClass}
                    disabled={loading}
                  />
                  <input
                    type="password"
                    value={password}
                    onChange={e => { setPassword(e.target.value); setError('') }}
                    placeholder="Пароль"
                    className={inputClass}
                    disabled={loading}
                  />
                  <input
                    type="text"
                    value={inviteToken}
                    onChange={e => { setInviteToken(e.target.value); setError('') }}
                    placeholder="или Invite-код"
                    className={inputClass}
                    disabled={loading}
                  />
                  <button
                    type="submit"
                    disabled={loading || (!email.trim() && !inviteToken.trim())}
                    className="w-full bg-green-600 hover:bg-green-500 disabled:bg-white/5 disabled:text-zinc-600
                               text-black font-bold text-sm rounded-xl px-4 py-2.5 transition-all cursor-pointer
                               disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="inline-block w-3 h-3 border-2 border-zinc-600 border-t-transparent rounded-full animate-spin" />
                        Проверка...
                      </span>
                    ) : '→ Войти'}
                  </button>
                </form>
              )}
            </div>
          )}

          {/* ── REGISTER TAB ──────────────────────────────────────── */}
          {tab === 'register' && (
            <form onSubmit={handleRegister} className="flex flex-col gap-3">

              {/* Quick register via Telegram */}
              {botStatus !== 'waiting' ? (
                <button
                  type="button"
                  onClick={handleBotLogin}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2.5 bg-[#229ED9] hover:bg-[#1a8abf] disabled:opacity-50
                             text-white font-bold text-sm rounded-xl px-4 py-3.5 transition-all cursor-pointer
                             disabled:cursor-not-allowed"
                >
                  <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/>
                  </svg>
                  Зарегистрироваться через Telegram
                </button>
              ) : (
                <div className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3.5 mb-1">
                  <div className="flex items-center gap-2.5 mb-2">
                    <div className="w-3.5 h-3.5 border-2 border-[#229ED9] border-t-transparent rounded-full animate-spin flex-shrink-0" />
                    <span className="text-zinc-200 text-sm font-bold">Ожидаем подтверждение</span>
                    <span className="ml-auto text-zinc-600 text-xs tabular-nums">
                      {Math.floor(pollSecondsLeft / 60)}:{String(pollSecondsLeft % 60).padStart(2, '0')}
                    </span>
                  </div>
                  <p className="text-zinc-500 text-xs mb-3">Нажмите <b className="text-zinc-300">Start</b> в боте <span className="text-[#229ED9]">@{TG_BOT}</span></p>
                  <div className="flex gap-2">
                    <a href={`https://t.me/${TG_BOT}?start=web_${botStateKey}`} target="_blank" rel="noopener noreferrer"
                      className="flex-1 text-center text-xs bg-[#229ED9]/20 hover:bg-[#229ED9]/30 text-[#229ED9] border border-[#229ED9]/30 rounded-lg py-1.5 transition-colors cursor-pointer">
                      Открыть бота
                    </a>
                    <button onClick={cancelBotAuth} className="flex-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-lg py-1.5 transition-colors cursor-pointer">
                      Отмена
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-white/8" />
                <span className="text-[10px] text-zinc-700">или с email</span>
                <div className="flex-1 h-px bg-white/8" />
              </div>

              <input
                type="email"
                value={regEmail}
                onChange={e => { setRegEmail(e.target.value); setError('') }}
                placeholder="Email *"
                className={inputClass}
                autoFocus
                disabled={loading}
              />
              <input
                type="password"
                value={regPassword}
                onChange={e => { setRegPassword(e.target.value); setError('') }}
                placeholder="Пароль * (мин. 6 символов)"
                className={inputClass}
                disabled={loading}
              />
              <input
                type="text"
                value={regName}
                onChange={e => setRegName(e.target.value)}
                placeholder="Имя (необязательно)"
                className={inputClass}
                disabled={loading}
              />
              <input
                type="text"
                value={regInvite}
                onChange={e => setRegInvite(e.target.value)}
                placeholder="Invite-код (даёт Pro)"
                className={inputClass}
                disabled={loading}
              />

              <button
                type="submit"
                disabled={loading || !regEmail.trim() || !regPassword}
                className="w-full bg-green-600 hover:bg-green-500 disabled:bg-white/5 disabled:text-zinc-600
                           text-black font-bold text-sm rounded-xl px-4 py-2.5 transition-all cursor-pointer
                           disabled:cursor-not-allowed mt-1"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="inline-block w-3 h-3 border-2 border-zinc-600 border-t-transparent rounded-full animate-spin" />
                    Создаю...
                  </span>
                ) : '→ Создать аккаунт'}
              </button>
            </form>
          )}
        </div>

        {/* Contact card */}
        <div className="mt-4 rounded-xl border border-white/8 bg-white/[0.02] p-4 text-center">
          <p className="text-xs text-zinc-600 mb-2">Нужен доступ или есть вопросы?</p>
          <a
            href="https://t.me/duhdeveloper"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block px-5 py-2 bg-green-600/80 hover:bg-green-600 text-white rounded-lg text-xs font-bold transition-colors"
          >
            Написать @duhdeveloper
          </a>
        </div>

        <div className="text-center mt-4 text-[10px] text-zinc-800">WA Dealer v1.0</div>
      </div>
    </div>
  )
}
