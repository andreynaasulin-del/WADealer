'use client'
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'

interface AuthState {
  isAuthenticated: boolean
  isLoading: boolean
  sessionToken: string | null
  login: (inviteToken: string) => Promise<{ ok: boolean; error?: string }>
  logout: () => void
  getToken: () => string | null
}

const AuthContext = createContext<AuthState>({
  isAuthenticated: false,
  isLoading: true,
  sessionToken: null,
  login: async () => ({ ok: false }),
  logout: () => { },
  getToken: () => null,
})

const STORAGE_KEY = 'wa_dealer_auth_token'

// No demo mode — always require real backend connection

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sessionToken, setSessionToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // ── Check stored token on mount ────────────────────────────────────────────
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) {
      setIsLoading(false)
      return
    }

    // Clear any stale demo mode flags
    localStorage.removeItem('wa_dealer_demo_mode')

    // Verify token with backend
    fetch('/api/auth/verify', {
      headers: { 'Authorization': `Bearer ${stored}` },
    })
      .then(res => {
        if (res.ok) {
          setSessionToken(stored)
        } else {
          localStorage.removeItem(STORAGE_KEY)
        }
      })
      .catch(() => {
        // If backend is down, keep the token (optimistic)
        setSessionToken(stored)
      })
      .finally(() => setIsLoading(false))
  }, [])

  // ── Login with invite token ───────────────────────────────────────────────
  const login = useCallback(async (inviteToken: string): Promise<{ ok: boolean; error?: string }> => {
    // Step 1: Try to reach the backend
    let res: Response | null = null
    try {
      res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: inviteToken }),
      })
    } catch (_e) {
      void _e
      return { ok: false, error: 'Сервер недоступен. Проверь подключение.' }
    }

    // Step 2: Check if response is JSON (not Vercel's HTML error page)
    let data: Record<string, unknown> | null = null
    try {
      const text = await res.text()
      data = JSON.parse(text)
    } catch (_e) {
      void _e
      return { ok: false, error: 'Сервер вернул невалидный ответ' }
    }

    // Step 3: Backend responded with JSON — check if login was successful
    if (!res.ok || !data) {
      const errorMsg = (data?.error as string) || 'Ошибка входа'
      return { ok: false, error: errorMsg }
    }

    // Step 4: Successful real login
    const token = data.session_token as string
    localStorage.setItem(STORAGE_KEY, token)
    localStorage.removeItem('wa_dealer_demo_mode')
    setSessionToken(token)
    return { ok: true }
  }, [])

  // ── Logout ────────────────────────────────────────────────────────────────
  const logout = useCallback(() => {
    const token = localStorage.getItem(STORAGE_KEY)
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      }).catch(() => { })
    }
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem('wa_dealer_demo_mode')
    setSessionToken(null)
  }, [])

  // ── Get token (for API calls) ─────────────────────────────────────────────
  const getToken = useCallback(() => {
    return sessionToken || localStorage.getItem(STORAGE_KEY)
  }, [sessionToken])

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: !!sessionToken,
        isLoading,
        sessionToken,
        login,
        logout,
        getToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
