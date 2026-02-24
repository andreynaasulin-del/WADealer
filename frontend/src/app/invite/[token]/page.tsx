'use client'
import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { login, isAuthenticated, isLoading } = useAuth()
  const [error, setError] = useState('')
  const [attempting, setAttempting] = useState(true)

  useEffect(() => {
    if (isLoading) return
    if (isAuthenticated) {
      window.location.href = '/'
      return
    }

    // Auto-login with the invite token from URL
    params.then(({ token }) => {
      login(token).then(result => {
        if (result.ok) {
          window.location.href = '/'
        } else {
          setError(result.error || 'Недействительная ссылка-приглашение')
          setAttempting(false)
        }
      })
    })
  }, [isLoading, isAuthenticated, login, params])

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 font-mono flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center">
        <div className="text-green-400 font-bold text-2xl tracking-wider mb-6">
          ◈ WA DEALER
        </div>

        {attempting && !error ? (
          <div className="flex flex-col items-center gap-3">
            <span className="inline-block w-6 h-6 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-zinc-500 text-sm">Проверка приглашения...</p>
          </div>
        ) : (
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
            <div className="text-red-400 text-sm mb-4">{error}</div>
            <a
              href="/login"
              className="inline-block bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs rounded px-4 py-2
                         transition-colors border border-zinc-700"
            >
              Перейти на страницу входа
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
