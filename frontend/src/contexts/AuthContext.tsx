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
  logout: () => {},
  getToken: () => null,
})

const STORAGE_KEY = 'wa_dealer_auth_token'

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
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: inviteToken }),
      })

      const data = await res.json()

      if (!res.ok) {
        return { ok: false, error: data.error || 'Ошибка входа' }
      }

      const token = data.session_token
      localStorage.setItem(STORAGE_KEY, token)
      setSessionToken(token)
      return { ok: true }
    } catch {
      // Backend unavailable — demo/offline mode: accept any non-empty token
      const demoToken = `demo_${Date.now()}_${Math.random().toString(36).slice(2)}`
      localStorage.setItem(STORAGE_KEY, demoToken)
      localStorage.setItem('wa_dealer_demo_mode', '1')
      setSessionToken(demoToken)
      return { ok: true }
    }
  }, [])

  // ── Logout ────────────────────────────────────────────────────────────────
  const logout = useCallback(() => {
    const token = localStorage.getItem(STORAGE_KEY)
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      }).catch(() => {})
    }
    localStorage.removeItem(STORAGE_KEY)
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
