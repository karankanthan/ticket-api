import { vi } from 'vitest'

type Handler = (body: unknown, url: URL) => { status?: number; body: unknown } | unknown

interface Route {
  method: string
  path: string | RegExp
  handler: Handler
}

export interface Call {
  method: string
  path: string
  body: unknown
}

/** Minimal fetch router for tests: register responses per method + path, inspect calls. */
export function mockApi(routes: Record<string, Handler | unknown>) {
  const table: Route[] = Object.entries(routes).map(([key, value]) => {
    const [method, path] = key.split(' ')
    return {
      method,
      path: path.startsWith('^') ? new RegExp(path) : path,
      handler: typeof value === 'function' ? (value as Handler) : () => value,
    }
  })
  const calls: Call[] = []

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, path: url.pathname + url.search, body })
    // The app must only call its own origin (the dev proxy); anything else is a bug.
    if (url.origin !== 'http://localhost') {
      return new Response(JSON.stringify({ detail: `Unexpected request to another origin: ${url.origin}` }), { status: 599 })
    }
    const route = table.find((r) => r.method === method && (typeof r.path === 'string' ? r.path === url.pathname : r.path.test(url.pathname)))
    if (!route) return new Response(JSON.stringify({ detail: `No mock for ${method} ${url.pathname}` }), { status: 404 })
    const result = route.handler(body, url)
    const wrapped = result && typeof result === 'object' && 'status' in result && 'body' in result ? (result as { status: number; body: unknown }) : { status: 200, body: result }
    return new Response(JSON.stringify(wrapped.body), { status: wrapped.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)

  return {
    calls,
    fetchMock,
    callsTo: (method: string, path: string) => calls.filter((c) => c.method === method && c.path.split('?')[0] === path),
  }
}
