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
  const wsRef    = useRef<WebSocket | null>(null)
  const cbRef    = useRef(onMessage)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  cbRef.current = onMessage

  const connect = useCallback(() => {
    if (!WS_BASE) return
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    // Append auth token to WS URL
    let wsUrl = WS_BASE
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem(AUTH_STORAGE_KEY)
      if (token) {
        const sep = wsUrl.includes('?') ? '&' : '?'
        wsUrl = `${wsUrl}${sep}token=${encodeURIComponent(token)}`
      }
    }

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      console.log('[WS] Connected')
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    }

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as WSEvent
        cbRef.current(data)
      } catch (_) {}
    }

    ws.onclose = () => {
      console.log('[WS] Disconnected — reconnecting in 3s')
      timerRef.current = setTimeout(connect, 3_000)
    }

    ws.onerror = () => ws.close()
  }, [])

  useEffect(() => {
    connect()
    return () => {
      wsRef.current?.close()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [connect])
}
