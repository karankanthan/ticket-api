// Central HTTP client. Every request goes through here so errors are handled one way.

const ADMIN_KEY_STORAGE = 'ticketflow.adminKey'

// In development every call goes through the Vite proxy to the local FastAPI (see vite.config.ts).
// VITE_API_BASE_URL is honoured only in production builds: Vite also loads .env during
// development, and the Task 4 deployment's .env points it at the hosted API, which made the
// local app silently talk to the deployed backend.
export function apiBaseUrl(env: { DEV: boolean; VITE_API_BASE_URL?: string } = import.meta.env): string {
  return env.DEV ? '' : (env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')
}

export const API_BASE_URL = apiBaseUrl()

export class ApiError extends Error {
  status: number
  detail: unknown

  constructor(status: number, message: string, detail?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }

  get isAuthError() {
    return this.status === 401
  }

  get isNetworkError() {
    return this.status === 0
  }
}

// The admin key is typed in by the user and kept only for this browser tab session.
// It is never part of the built frontend code.
export function getAdminKey(): string {
  try {
    return sessionStorage.getItem(ADMIN_KEY_STORAGE) ?? ''
  } catch {
    return ''
  }
}

export function setAdminKey(key: string) {
  try {
    if (key) sessionStorage.setItem(ADMIN_KEY_STORAGE, key)
    else sessionStorage.removeItem(ADMIN_KEY_STORAGE)
  } catch {
    // storage unavailable (private mode); the key simply is not remembered
  }
}

function messageFrom(status: number, body: unknown): string {
  if (body && typeof body === 'object' && 'detail' in body) {
    const detail = (body as { detail: unknown }).detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) {
      // FastAPI validation errors: [{loc: [...], msg: "..."}]
      return detail
        .map((d) => {
          const item = d as { loc?: unknown[]; msg?: string }
          const field = item.loc?.filter((p) => p !== 'body').join('.')
          return field ? `${field}: ${item.msg}` : item.msg
        })
        .join('; ')
    }
    if (detail && typeof detail === 'object' && 'message' in detail) {
      return String((detail as { message: unknown }).message)
    }
  }
  if (status === 401) return 'An admin key is required. Add it in Settings.'
  if (status >= 500) return 'The server had a problem. Please try again.'
  return `Request failed (${status}).`
}

export interface RequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  signal?: AbortSignal
  admin?: boolean
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, admin = true } = options
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const key = admin ? getAdminKey() : ''
  if (key) headers['X-Admin-Key'] = key

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error
    throw new ApiError(0, 'Cannot reach the TicketFlow API. Check that the backend is running.')
  }

  const text = await response.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  if (!response.ok) {
    const detail = data && typeof data === 'object' && 'detail' in data ? (data as { detail: unknown }).detail : data
    throw new ApiError(response.status, messageFrom(response.status, data), detail)
  }
  return data as T
}
