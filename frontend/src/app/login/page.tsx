'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'

export default function LoginPage() {
  const { login, isAuthenticated, isLoading } = useAuth()
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Redirect if already authenticated
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      window.location.href = '/'
    }
  }, [isAuthenticated, isLoading])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token.trim()) return

    setLoading(true)
    setError('')

    const result = await login(token.trim())

    if (result.ok) {
      window.location.href = '/'
    } else {
      setError(result.error || 'Ошибка входа')
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

        {/* Login card */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
          <h2 className="text-sm font-bold text-zinc-400 mb-4 uppercase tracking-wider">
            Авторизация
          </h2>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label htmlFor="invite-token" className="block text-xs text-zinc-500 mb-1.5">
                Введите ссылку-приглашение для входа
              </label>
              <input
                id="invite-token"
                type="text"
                value={token}
                onChange={e => { setToken(e.target.value); setError('') }}
                placeholder="Вставьте код или ссылку-приглашение..."
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2.5 text-sm text-zinc-200
                           placeholder-zinc-600 focus:outline-none focus:border-green-500 transition-colors"
                autoFocus
                disabled={loading}
              />
              <p className="text-[10px] text-zinc-700 mt-1">
                Пример: https://...../invite/abc123 или просто код abc123
              </p>
            </div>

            {error && (
              <div className="text-xs text-red-400 bg-red-950/20 border border-red-900/50 rounded px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !token.trim()}
              className="w-full bg-green-600 hover:bg-green-500 disabled:bg-zinc-800 disabled:text-zinc-600
                         text-black font-bold text-sm rounded px-4 py-2.5 transition-colors cursor-pointer
                         disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="inline-block w-3 h-3 border-2 border-zinc-600 border-t-transparent rounded-full animate-spin" />
                  Проверка...
                </span>
              ) : (
                '→ Войти'
              )}
            </button>
          </form>

          <div className="mt-4 pt-4 border-t border-zinc-800">
            <p className="text-[10px] text-zinc-700 text-center">
              Ссылку-приглашение можно получить у администратора системы
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-6 text-[10px] text-zinc-800">
          WA Dealer v1.0
        </div>
      </div>
    </div>
  )
}
