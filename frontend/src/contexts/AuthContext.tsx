'use client'
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'

interface User {
  id: string
  email: string
  display_name: string
  tier: string
  is_admin: boolean
  role: string
  team_id: string | null
  team_role: string | null
  team_name: string | null
}

interface AuthState {
  isAuthenticated: boolean
  isLoading: boolean
  sessionToken: string | null
  user: User | null
  login: (inviteToken?: string, email?: string, password?: string) => Promise<{ ok: boolean; error?: string }>
  register: (email: string, password: string, displayName?: string, inviteCode?: string) => Promise<{ ok: boolean; error?: string }>
  logout: () => void
  getToken: () => string | null
}

const AuthContext = createContext<AuthState>({
  isAuthenticated: false,
  isLoading: true,
  sessionToken: null,
  user: null,
  login: async () => ({ ok: false }),
  register: async () => ({ ok: false }),
  logout: () => { },
  getToken: () => null,
})

const STORAGE_KEY = 'wa_dealer_auth_token'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sessionToken, setSessionToken] = useState<string | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // ── Load user profile ────────────────────────────────────────────────────
  const loadUser = useCallback(async (token: string) => {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setUser(data)
      }
    } catch {}
  }, [])

  // ── Check stored token on mount ──────────────────────────────────────────
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) {
      setIsLoading(false)
      return
    }

    localStorage.removeItem('wa_dealer_demo_mode')

    fetch('/api/auth/verify', {
      headers: { 'Authorization': `Bearer ${stored}` },
    })
      .then(async res => {
        if (res.ok) {
          setSessionToken(stored)
          await loadUser(stored)
        } else {
          localStorage.removeItem(STORAGE_KEY)
        }
      })
      .catch(() => {
        setSessionToken(stored)
      })
      .finally(() => setIsLoading(false))
  }, [loadUser])

  // ── Login with email/password or invite token ───────────────────────────
  const login = useCallback(async (inviteToken?: string, email?: string, password?: string): Promise<{ ok: boolean; error?: string }> => {
    let res: Response | null = null
    try {
      const body: Record<string, string> = {}
      if (email && password) {
        body.email = email
        body.password = password
      } else if (inviteToken) {
        body.token = inviteToken
      }

      res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch {
      return { ok: false, error: 'Сервер недоступен. Проверь подключение.' }
    }

    let data: Record<string, unknown> | null = null
    try {
      const text = await res.text()
      data = JSON.parse(text)
    } catch {
      return { ok: false, error: 'Сервер вернул невалидный ответ' }
    }

    if (!res.ok || !data) {
      return { ok: false, error: (data?.error as string) || 'Ошибка входа' }
    }

    const token = data.session_token as string
    localStorage.setItem(STORAGE_KEY, token)
    localStorage.removeItem('wa_dealer_demo_mode')
    setSessionToken(token)

    if (data.user) {
      setUser(data.user as User)
    } else {
      await loadUser(token)
    }

    return { ok: true }
  }, [loadUser])

  // ── Register with email/password ────────────────────────────────────────
  const register = useCallback(async (email: string, password: string, displayName?: string, inviteCode?: string): Promise<{ ok: boolean; error?: string }> => {
    let res: Response | null = null
    try {
      res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, display_name: displayName, invite_code: inviteCode }),
      })
    } catch {
      return { ok: false, error: 'Сервер недоступен. Проверь подключение.' }
    }

    let data: Record<string, unknown> | null = null
    try {
      const text = await res.text()
      data = JSON.parse(text)
    } catch {
      return { ok: false, error: 'Сервер вернул невалидный ответ' }
    }

    if (!res.ok || !data) {
      return { ok: false, error: (data?.error as string) || 'Ошибка регистрации' }
    }

    const token = data.session_token as string
    localStorage.setItem(STORAGE_KEY, token)
    setSessionToken(token)

    if (data.user) {
      setUser(data.user as User)
    }

    return { ok: true }
  }, [])

  // ── Logout ──────────────────────────────────────────────────────────────
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
    setUser(null)
  }, [])

  const getToken = useCallback(() => {
    return sessionToken || localStorage.getItem(STORAGE_KEY)
  }, [sessionToken])

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: !!sessionToken,
        isLoading,
        sessionToken,
        user,
        login,
        register,
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
