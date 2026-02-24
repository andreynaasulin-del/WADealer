'use client'
import { useEffect, useRef, useCallback } from 'react'

const WS_BASE =
  typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_BACKEND_WS_URL || 'ws://localhost:3001/ws')
    : ''

const AUTH_STORAGE_KEY = 'wa_dealer_auth_token'

export type WSEvent = {
  type: string
  [key: string]: unknown
}

export function useWS(onMessage: (event: WSEvent) => void) {
  const wsRef      = useRef<WebSocket | null>(null)
  const cbRef      = useRef(onMessage)
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptsRef = useRef(0)

  cbRef.current = onMessage

  const connect = useCallback(() => {
    if (!WS_BASE) return
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    // In demo mode — don't spam reconnect attempts, use long backoff
    const isDemoMode = typeof window !== 'undefined' && localStorage.getItem('wa_dealer_demo_mode') === '1'
    if (isDemoMode && attemptsRef.current > 1) {
      // Stop trying in demo mode after 2 attempts
      return
    }

    // Append auth token to WS URL
    let wsUrl = WS_BASE
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem(AUTH_STORAGE_KEY)
      if (token) {
        const sep = wsUrl.includes('?') ? '&' : '?'
        wsUrl = `${wsUrl}${sep}token=${encodeURIComponent(token)}`
      }
    }

    try {
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        console.log('[WS] Connected')
        attemptsRef.current = 0
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
      }

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data) as WSEvent
          cbRef.current(data)
        } catch (_) { void _ }
      }

      ws.onclose = () => {
        attemptsRef.current++
        const delay = Math.min(3_000 * Math.pow(2, attemptsRef.current - 1), 30_000)
        if (attemptsRef.current <= 3) {
          console.log(`[WS] Disconnected — reconnecting in ${Math.round(delay / 1000)}s (attempt ${attemptsRef.current})`)
        }
        timerRef.current = setTimeout(connect, delay)
      }

      ws.onerror = () => ws.close()
    } catch {
      // WebSocket constructor failed (e.g. invalid URL) — silently give up
      attemptsRef.current = 99
    }
  }, [])

  useEffect(() => {
    connect()
    return () => {
      wsRef.current?.close()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [connect])
}
