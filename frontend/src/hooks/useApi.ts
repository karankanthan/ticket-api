import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'

const REFRESH_EVENT = 'ticketflow:refresh'

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ticketflow') : null
channel?.addEventListener('message', () => window.dispatchEvent(new Event(REFRESH_EVENT)))

/** Ask every mounted useApi hook to reload, in this tab and in other open TicketFlow tabs. */
export function broadcastRefresh() {
  window.dispatchEvent(new Event(REFRESH_EVENT))
  channel?.postMessage('refresh')
}

export interface ApiState<T> {
  data: T | undefined
  error: ApiError | undefined
  loading: boolean
  refreshing: boolean
  updatedAt: Date | undefined
  reload: () => void
}

interface Options {
  /** Reload every N milliseconds while the page is visible. */
  pollMs?: number
}

/**
 * Load data from the API. Keeps the last good data while refreshing, and never
 * replaces a failed response with placeholder data.
 */
export function useApi<T>(fetcher: (signal: AbortSignal) => Promise<T>, deps: unknown[] = [], options: Options = {}): ApiState<T> {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<ApiError>()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<Date>()
  const [tick, setTick] = useState(0)
  const fetcherRef = useRef(fetcher)
  const hasData = useRef(false)

  useEffect(() => {
    fetcherRef.current = fetcher
  })

  const reload = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    if (hasData.current) setRefreshing(true)
    else setLoading(true)

    fetcherRef
      .current(controller.signal)
      .then((result) => {
        hasData.current = true
        setData(result)
        setError(undefined)
        setUpdatedAt(new Date())
      })
      .catch((err: unknown) => {
        if ((err as Error)?.name === 'AbortError') return
        setError(err instanceof ApiError ? err : new ApiError(0, (err as Error)?.message || 'Unexpected error'))
      })
      .finally(() => {
        if (controller.signal.aborted) return
        setLoading(false)
        setRefreshing(false)
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps])

  useEffect(() => {
    window.addEventListener(REFRESH_EVENT, reload)
    const onFocus = () => {
      if (document.visibilityState === 'visible') reload()
    }
    document.addEventListener('visibilitychange', onFocus)
    let timer: number | undefined
    if (options.pollMs) {
      timer = window.setInterval(() => {
        if (document.visibilityState !== 'hidden') reload()
      }, options.pollMs)
    }
    return () => {
      window.removeEventListener(REFRESH_EVENT, reload)
      document.removeEventListener('visibilitychange', onFocus)
      if (timer) window.clearInterval(timer)
    }
  }, [reload, options.pollMs])

  return { data, error, loading, refreshing, updatedAt, reload }
}
