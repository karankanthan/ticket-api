import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, apiBaseUrl, request, setAdminKey } from '../api/client'
import * as f from './fixtures'
import { mockApi } from './mockApi'
import { renderApp } from './render'

const health = { status: 'ok', tickets_loaded: 120, store_dir_writable: true, email_backend: 'file', email_ready: true, scheduler_enabled: true, scheduler_last_run_at: null }

function baseRoutes(overrides: Record<string, unknown> = {}) {
  return {
    'GET /api/health': health,
    'GET /api/dashboard': f.dashboard(),
    'GET /api/activity': [{ event_id: 'EVT-1', event: 'decision', message: 'REQ-1 (TCK-101) marked approved via email', details: {}, at: '2026-10-30T11:00:00+05:30' }],
    'GET /api/tickets': { total: f.tickets.length, generated_at: '', tickets: f.tickets },
    'GET /api/control-center/queue': { total: f.queue.length, items: f.queue },
    'GET /api/approvals': [],
    'GET /api/email/status': f.fileEmail,
    ...overrides,
  }
}

describe('navigation', () => {
  it('shows the dashboard with real API numbers and navigates between pages', async () => {
    mockApi(baseRoutes())
    renderApp('/')

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(await screen.findByText('120')).toBeInTheDocument() // total tickets from /api/dashboard
    const openCard = screen.getByText('Open tickets').closest('div.rounded-xl') as HTMLElement
    expect(within(openCard).getByText('79')).toBeInTheDocument() // open + in progress
    expect(screen.getByText('REQ-1 (TCK-101) marked approved via email')).toBeInTheDocument()
    expect(screen.getByText(/Local email mode \(file\)/)).toBeInTheDocument()

    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    fireEvent.click(within(nav).getByRole('link', { name: /All Tickets/ }))
    expect(await screen.findByRole('heading', { name: 'All Tickets' })).toBeInTheDocument()

    fireEvent.click(within(nav).getByRole('link', { name: /Control Center/ }))
    expect(await screen.findByRole('heading', { name: 'Approval Control Center' })).toBeInTheDocument()
  })

  it('does not offer AI Triage: no sidebar item and no route', async () => {
    mockApi(baseRoutes())
    renderApp('/ai-triage')
    expect(await screen.findByText('Page not found')).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(within(nav).queryByRole('link', { name: /triage/i })).not.toBeInTheDocument()
    expect(within(nav).getAllByRole('link').map((a) => a.getAttribute('href'))).not.toContain('/ai-triage')
  })

  it('shows the queue count badge in the sidebar', async () => {
    mockApi(baseRoutes())
    renderApp('/')
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' })
    expect(await within(nav).findByLabelText('8 items')).toBeInTheDocument()
  })

  it('renders the manager page without the app navigation', async () => {
    mockApi({ 'GET ^/api/manager/actions/': f.managerOutcome() })
    renderApp('/act/some-token')
    expect(await screen.findByRole('heading', { name: 'Approve request' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument()
  })
})

describe('dashboard', () => {
  it('shows an error with retry instead of fake data when the API fails', async () => {
    let fail = true
    mockApi(baseRoutes({ 'GET /api/dashboard': () => (fail ? { status: 500, body: { detail: 'boom' } } : f.dashboard()) }))
    renderApp('/')

    expect(await screen.findByText('Could not load data')).toBeInTheDocument()
    expect(screen.getByText('boom')).toBeInTheDocument()
    expect(screen.queryByText('120')).not.toBeInTheDocument()

    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('120')).toBeInTheDocument()
  })

  it('refreshes automatically so manager decisions appear', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let approved = 1
    const api = mockApi(baseRoutes({ 'GET /api/dashboard': () => f.dashboard({ approvals: { ...f.dashboard().approvals, by_status: { pending: 2, info_requested: 1, approved, rejected: 1 } } }) }))
    renderApp('/')
    const card = (await screen.findByText('Approved')).closest('div.rounded-xl') as HTMLElement
    expect(within(card).getByText('1')).toBeInTheDocument()

    approved = 2 // the manager approves another request through an email link
    const before = api.callsTo('GET', '/api/dashboard').length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(21_000)
    })
    await waitFor(() => expect(api.callsTo('GET', '/api/dashboard').length).toBeGreaterThan(before))
    await waitFor(() => expect(within(card).getByText('2')).toBeInTheDocument())
  })

  it('tells the user when the backend is not reachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    renderApp('/')
    expect(await screen.findByText('Backend not reachable')).toBeInTheDocument()
  })
})

describe('API client', () => {
  it('uses the local dev proxy even when .env sets VITE_API_BASE_URL (regression)', async () => {
    expect(apiBaseUrl({ DEV: true, VITE_API_BASE_URL: 'https://ticket-triage-api-f7n2.onrender.com' })).toBe('')
    expect(apiBaseUrl({ DEV: false, VITE_API_BASE_URL: 'https://api.example.com/' })).toBe('https://api.example.com')
    expect(apiBaseUrl({ DEV: false })).toBe('')

    const api = mockApi({ 'GET /api/health': health })
    await request('/api/health')
    expect(String((api.fetchMock.mock.calls[0] as unknown[])[0])).toBe('/api/health')
  })

  it('turns FastAPI validation errors into readable messages', async () => {
    mockApi({ 'POST /x': { status: 422, body: { detail: [{ loc: ['body', 'count'], msg: 'must be at least 1' }] } } })
    await expect(request('/x', { method: 'POST', body: {} })).rejects.toThrow('count: must be at least 1')
  })

  it('reports a missing admin key as an auth error', async () => {
    mockApi({ 'GET /y': { status: 401, body: { detail: 'A valid X-Admin-Key header is required.' } } })
    const error = await request('/y').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).isAuthError).toBe(true)
  })

  it('sends the session admin key only to admin APIs', async () => {
    const api = mockApi({ 'GET /a': {}, 'GET /b': {} })
    setAdminKey('k-123')
    await request('/a')
    await request('/b', { admin: false })
    const headers = (api.fetchMock.mock.calls as unknown as [string, RequestInit][]).map(([, init]) => (init.headers as Record<string, string>)['X-Admin-Key'])
    expect(headers).toEqual(['k-123', undefined])
  })
})
