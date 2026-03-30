'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function AuthCallbackPage() {
  const [error, setError] = useState('')
  const [status, setStatus] = useState('Авторизация через Google...')

  useEffect(() => {
    async function handleCallback() {
      try {
        // Get Supabase session (set by OAuth redirect)
        const { data: { session }, error: sessionError } = await supabase.auth.getSession()

        if (sessionError || !session) {
          setError('Не удалось получить сессию Google. Попробуйте снова.')
          return
        }

        setStatus('Создаю аккаунт...')

        // Send access_token to our backend to create/find user + session
        const res = await fetch('/api/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_token: session.access_token }),
        })

        const data = await res.json()

        if (!res.ok || !data.session_token) {
          setError(data.error || 'Ошибка создания сессии')
          return
        }

        // Save our custom session token
        localStorage.setItem('wa_dealer_auth_token', data.session_token)
        localStorage.removeItem('wa_dealer_demo_mode')

        // Sign out from Supabase Auth (we don't need it anymore)
        await supabase.auth.signOut()

        setStatus('Успешно! Перенаправляю...')
        window.location.href = '/'
      } catch (err) {
        setError('Ошибка авторизации: ' + (err as Error).message)
      }
    }

    handleCallback()
  }, [])

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="text-center">
        <div className="text-green-400 font-bold text-2xl tracking-wider mb-6">
          ◈ WA DEALER
        </div>
        {error ? (
          <div className="text-red-400 text-sm font-mono mb-4">
            {error}
            <br />
            <a href="/login" className="text-blue-400 underline mt-2 inline-block">
              ← Вернуться к входу
            </a>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="inline-block w-4 h-4 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-zinc-400 text-sm font-mono">{status}</span>
          </div>
        )}
      </div>
    </div>
  )
}
