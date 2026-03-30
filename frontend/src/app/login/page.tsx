'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'

type Tab = 'login' | 'register'

export default function LoginPage() {
  const { login, register, isAuthenticated, isLoading } = useAuth()
  const [tab, setTab] = useState<Tab>('login')

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

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      window.location.href = '/'
    }
  }, [isAuthenticated, isLoading])

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
      setError('Введите email+пароль или invite-код')
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
      options: {
        redirectTo: window.location.origin + '/auth/callback',
      },
    })
    if (error) {
      setError(error.message)
      setLoading(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-600 text-sm font-mono">Загрузка...</div>
      </div>
    )
  }

  const inputClass = "w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-green-500 transition-colors"

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 font-mono flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-green-400 font-bold text-2xl tracking-wider mb-2">
            ◈ WA DEALER
          </div>
          <div className="text-zinc-600 text-xs">
            Мульти-сессия WhatsApp рассылки
          </div>
        </div>

        {/* Tabs */}
        <div className="flex mb-0 border-b border-zinc-800">
          {(['login', 'register'] as const).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setError('') }}
              className={`flex-1 py-2.5 text-sm font-bold tracking-wider transition-colors cursor-pointer ${
                tab === t
                  ? 'text-green-400 border-b-2 border-green-400'
                  : 'text-zinc-600 hover:text-zinc-400'
              }`}
            >
              {t === 'login' ? 'ВХОД' : 'РЕГИСТРАЦИЯ'}
            </button>
          ))}
        </div>

        {/* Card */}
        <div className="bg-zinc-900/50 border border-zinc-800 border-t-0 rounded-b-lg p-6">

          {/* Google Login */}
          {isSupabaseConfigured && (
            <>
              <button
                onClick={handleGoogleLogin}
                disabled={loading}
                className="w-full flex items-center justify-center gap-3 bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-900
                           border border-zinc-700 text-zinc-200 font-medium text-sm rounded px-4 py-2.5
                           transition-colors cursor-pointer disabled:cursor-not-allowed mb-4"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Войти через Google
              </button>

              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 h-px bg-zinc-800" />
                <span className="text-[10px] text-zinc-700">или</span>
                <div className="flex-1 h-px bg-zinc-800" />
              </div>
            </>
          )}

          {error && (
            <div className="text-xs text-red-400 bg-red-950/20 border border-red-900/50 rounded px-3 py-2 mb-4">
              {error}
            </div>
          )}

          {/* ── Login Tab ────────────────────────────────────── */}
          {tab === 'login' && (
            <form onSubmit={handleLogin} className="flex flex-col gap-3">
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError('') }}
                  placeholder="you@example.com"
                  className={inputClass}
                  autoFocus
                  disabled={loading}
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Пароль</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError('') }}
                  placeholder="••••••"
                  className={inputClass}
                  disabled={loading}
                />
              </div>

              <div className="flex items-center gap-3 my-1">
                <div className="flex-1 h-px bg-zinc-800" />
                <span className="text-[10px] text-zinc-700">или invite-код</span>
                <div className="flex-1 h-px bg-zinc-800" />
              </div>

              <input
                type="text"
                value={inviteToken}
                onChange={e => { setInviteToken(e.target.value); setError('') }}
                placeholder="Вставьте invite-код..."
                className={inputClass}
                disabled={loading}
              />

              <button
                type="submit"
                disabled={loading || (!email.trim() && !inviteToken.trim())}
                className="w-full bg-green-600 hover:bg-green-500 disabled:bg-zinc-800 disabled:text-zinc-600
                           text-black font-bold text-sm rounded px-4 py-2.5 transition-colors cursor-pointer
                           disabled:cursor-not-allowed mt-1"
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

          {/* ── Register Tab ─────────────────────────────────── */}
          {tab === 'register' && (
            <form onSubmit={handleRegister} className="flex flex-col gap-3">
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Email *</label>
                <input
                  type="email"
                  value={regEmail}
                  onChange={e => { setRegEmail(e.target.value); setError('') }}
                  placeholder="you@example.com"
                  className={inputClass}
                  autoFocus
                  disabled={loading}
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Пароль * (мин. 6 символов)</label>
                <input
                  type="password"
                  value={regPassword}
                  onChange={e => { setRegPassword(e.target.value); setError('') }}
                  placeholder="••••••"
                  className={inputClass}
                  disabled={loading}
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Имя</label>
                <input
                  type="text"
                  value={regName}
                  onChange={e => setRegName(e.target.value)}
                  placeholder="Как вас зовут?"
                  className={inputClass}
                  disabled={loading}
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Invite-код (необязательно, даёт Pro)</label>
                <input
                  type="text"
                  value={regInvite}
                  onChange={e => setRegInvite(e.target.value)}
                  placeholder="Код приглашения..."
                  className={inputClass}
                  disabled={loading}
                />
              </div>

              <button
                type="submit"
                disabled={loading || !regEmail.trim() || !regPassword}
                className="w-full bg-green-600 hover:bg-green-500 disabled:bg-zinc-800 disabled:text-zinc-600
                           text-black font-bold text-sm rounded px-4 py-2.5 transition-colors cursor-pointer
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

        {/* Footer */}
        <div className="text-center mt-6 text-[10px] text-zinc-800">
          WA Dealer v1.0
        </div>
      </div>
    </div>
  )
}
