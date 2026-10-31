import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { EmailStatus, Priority, QueueItem } from '../api/types'
import { exclusionReason, inScope, topN } from '../lib/selection'
import * as f from './fixtures'
import { mockApi } from './mockApi'
import { renderApp } from './render'

// Ranked queue spanning all four priorities, like the user's data: 4 P1, 2 P2, 3 P3, 1 P4.
function rankedQueue(count = 10): QueueItem[] {
  const pattern: Priority[] = ['urgent', 'urgent', 'urgent', 'urgent', 'high', 'high', 'normal', 'normal', 'normal', 'low']
  return Array.from({ length: count }, (_, i) => f.queueItem(i + 1, pattern[i % pattern.length], { rank: i + 1 }))
}

function setup(items: QueueItem[], awaiting = 5, email: Partial<EmailStatus> = {}) {
  return mockApi({
    'GET /api/health': { status: 'ok' },
    'GET /api/dashboard': f.dashboard(),
    'GET /api/control-center/queue': { total: items.length, items },
    'GET /api/approvals': (_: unknown, url: URL) => (url.searchParams.get('status') === 'pending' ? Array.from({ length: awaiting }, (_, i) => f.request(`REQ-${i + 1}`)) : []),
    'GET /api/email/status': { ...f.fileEmail, ...email },
    'POST /api/control-center/preview': (body: unknown) => {
      const ids = (body as { item_ids: string[] }).item_ids
      return { mode: 'manual', requested: ids.length, selected_count: ids.length, items: items.filter((i) => ids.includes(i.item_id)), item_ids: ids, warnings: [], email: { ...f.fileEmail, ...email } }
    },
    'POST /api/control-center/batches': () => ({ status: 201, body: f.batch() }),
    'GET ^/api/control-center/batches/': { ...f.batch(), requests: [] },
  })
}

const summary = () => screen.getByTestId('selection-summary').textContent
const exclusions = () => within(screen.getByTestId('exclusions')).getAllByRole('listitem').map((li) => li.textContent)
const load = (id = 'TCK-101') => screen.findByRole('link', { name: id })

describe('selection rules', () => {
  it('All eligible has no priority filter, including unknown priorities', () => {
    const odd = f.queueItem(1, 'low', { ticket: { ...f.queueItem(1, 'low').ticket!, priority: 'Critical' } })
    expect(inScope(odd, 'all')).toBe(true)
    expect(inScope(odd, 'p1')).toBe(false)
  })

  it('Top N takes the first N in ranking order within the scope', () => {
    const q = rankedQueue()
    expect(topN(q, 'all', 20)).toHaveLength(10)
    expect(topN(q, 'all', 3)).toEqual(['REC-1', 'REC-2', 'REC-3'])
    expect(topN(q, 'p1p2', 20)).toEqual(['REC-1', 'REC-2', 'REC-3', 'REC-4', 'REC-5', 'REC-6'])
  })

  it('gives an exact reason for each excluded ticket', () => {
    const q = rankedQueue()
    const preset = { count: 3, scope: 'all' as const, ids: ['REC-1', 'REC-2', 'REC-3'] }
    const ctx = { scope: 'all' as const, selected: new Set(['REC-1', 'REC-3']), matches: (i: QueueItem) => i.item_id !== 'REC-9', preset, items: q }
    expect(exclusionReason(q[0], ctx)).toBeNull()
    expect(exclusionReason(q[1], ctx)).toBe('Deselected manually')
    expect(exclusionReason(q[3], ctx)).toBe('Outside the Top 3 (ranked #4 of 10)')
    expect(exclusionReason(q[8], ctx)).toBe('Hidden by the current search or category filter')
    expect(exclusionReason(q[9], { ...ctx, scope: 'p1' })).toBe('Not in P1 only (P4 Low)')
    expect(exclusionReason(q[9], { ...ctx, preset: null })).toBe('Not selected')
  })
})

describe('Control Center selection', () => {
  it('Top 20 with All eligible selects all 10 eligible tickets across P1-P4 (reported bug)', async () => {
    setup(rankedQueue(10))
    renderApp('/control-center')
    await load()
    expect(screen.getByRole('radio', { name: 'All eligible' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Top 20' }))
    expect(summary()).toBe('10 of 10 eligible tickets selected')
    expect(screen.getByText('Every eligible ticket is selected.')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select TCK-110' })).toBeChecked() // the P4 ticket
    expect(screen.getByTestId('awaiting-note')).toHaveTextContent('Not counted as eligible: 5 ticket(s) already with the manager.')
    expect(await screen.findByText('Only 10 eligible tickets in All eligible priorities')).toBeInTheDocument()
  })

  it('Top 20 with 25 eligible selects exactly 20 and names the 5 left out', async () => {
    setup(rankedQueue(25))
    renderApp('/control-center')
    await load()
    fireEvent.click(screen.getByRole('button', { name: 'Top 20' }))
    expect(summary()).toBe('20 of 25 eligible tickets selected')
    expect(exclusions()).toEqual(
      [21, 22, 23, 24, 25].map((n) => `TCK-${100 + n}Outside the Top 20 (ranked #${n} of 25)`),
    )
  })

  it('Top 5 and Top 10 pick the highest ranked tickets', async () => {
    setup(rankedQueue(10))
    renderApp('/control-center')
    await load()
    fireEvent.click(screen.getByRole('button', { name: 'Top 5' }))
    expect(summary()).toBe('5 of 10 eligible tickets selected')
    expect(screen.getByRole('checkbox', { name: 'Select TCK-105' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Select TCK-106' })).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Top 10' }))
    expect(summary()).toBe('10 of 10 eligible tickets selected')
  })

  it('custom count selects that many', async () => {
    setup(rankedQueue(10))
    renderApp('/control-center')
    await load()
    fireEvent.change(screen.getByLabelText('Custom number of tickets'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Select top' }))
    expect(summary()).toBe('7 of 10 eligible tickets selected')
  })

  it('P1 + P2 keeps the chosen filter and explains every exclusion', async () => {
    setup(rankedQueue(10))
    renderApp('/control-center')
    await load()
    fireEvent.click(screen.getByRole('radio', { name: 'P1 + P2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Top 20' }))
    expect(screen.getByRole('radio', { name: 'P1 + P2' })).toHaveAttribute('aria-checked', 'true')
    expect(summary()).toBe('6 of 10 eligible tickets selected')
    expect(exclusions()).toEqual(['TCK-107Not in P1 + P2 (P3 Normal)', 'TCK-108Not in P1 + P2 (P3 Normal)', 'TCK-109Not in P1 + P2 (P3 Normal)', 'TCK-110Not in P1 + P2 (P4 Low)'])
  })

  it('manual deselection and selection update counts and reasons', async () => {
    setup(rankedQueue(10))
    renderApp('/control-center')
    await load()
    fireEvent.click(screen.getByRole('button', { name: 'Top 5' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select TCK-102' }))
    expect(summary()).toBe('4 of 10 eligible tickets selected')
    expect(exclusions()).toContain('TCK-102Deselected manually')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select TCK-109' }))
    expect(summary()).toBe('5 of 10 eligible tickets selected')
    expect(exclusions()).not.toContain('TCK-109Outside the Top 5 (ranked #9 of 10)')
  })

  it('review lists what will not be emailed and submits exactly the selection', async () => {
    const api = setup(rankedQueue(10))
    renderApp('/control-center')
    await load()
    fireEvent.click(screen.getByRole('button', { name: 'Top 5' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select TCK-103' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review & send' }))
    const review = await screen.findByRole('dialog', { name: 'Review batch before sending' })
    expect(within(review).getByText('6 eligible ticket(s) will not be emailed')).toBeInTheDocument()
    const rows = within(review).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[1].textContent)
    expect(rows).toEqual(['TCK-101', 'TCK-102', 'TCK-104', 'TCK-105'])
    fireEvent.click(within(review).getByRole('button', { name: /Create batch/ }))
    await waitFor(() => expect(api.callsTo('POST', '/api/control-center/batches')).toHaveLength(1))
    expect((api.callsTo('POST', '/api/control-center/batches')[0].body as { item_ids: string[] }).item_ids).toEqual(['REC-1', 'REC-2', 'REC-4', 'REC-5'])
  })

  it('shows real SMTP delivery to the manager in the review', async () => {
    setup(rankedQueue(3), 0, { backend: 'smtp', delivers_real_email: true, smtp_configured: true, manager_email: 'k***@gmail.com', smtp_host: 'smtp.gmail.com' })
    renderApp('/control-center')
    await load()
    fireEvent.click(screen.getByRole('button', { name: 'Top 5' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review & send' }))
    const review = await screen.findByRole('dialog', { name: 'Review batch before sending' })
    expect(within(review).getByText('The email goes to k***@gmail.com through smtp.gmail.com.')).toBeInTheDocument()
    expect(within(review).getByRole('button', { name: 'Send 3 to manager' })).toBeEnabled()
  })
})

describe('Settings email status', () => {
  const settings = (email: Partial<EmailStatus>) => ({
    environment: { app_env: 'local', admin_key_required: false, scheduler_enabled: true, scheduler_interval_seconds: 300, public_base_url: 'http://localhost:5173', ticket_data_file: 'x.csv', tickets_loaded: 120, store_dir: 'data/store' },
    sla: { ticket_sla_hours: { urgent: 4, high: 8, normal: 24, low: 72 }, approval_response_hours: { urgent: 4, high: 24, normal: 24, low: 24 }, at_risk_fraction: 0.25 },
    reminders: { after_hours: [2, 6, 24], max_reminders: 3, action_link_ttl_hours: 72 },
    approval_rules: [],
    batches: { max_batch_size: 100 },
    email: { ...f.fileEmail, ...email },
  })
  const open = (email: Partial<EmailStatus>) => {
    mockApi({ 'GET /api/health': { status: 'ok' }, 'GET /api/dashboard': f.dashboard(), 'GET /api/settings': settings(email) })
    renderApp('/settings')
  }

  it('Gmail without an App Password: manager set, SMTP not configured, not verified', async () => {
    open({ backend: 'smtp', delivers_real_email: true, ready: false, smtp_configured: false, manager_email: 'k***@gmail.com', manager_email_configured: true, missing_settings: ['SMTP_USERNAME', 'SMTP_PASSWORD'] })
    expect(await screen.findByText('Manager email set')).toBeInTheDocument()
    expect(screen.getByText('SMTP not fully configured')).toBeInTheDocument()
    expect(screen.getByText('Real delivery not verified yet')).toBeInTheDocument()
    expect(screen.getByText('Missing settings: SMTP_USERNAME, SMTP_PASSWORD')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send test email' })).toBeDisabled()
  })

  it('shows a failed login and only claims verification after a real success', async () => {
    open({ backend: 'smtp', delivers_real_email: true, smtp_configured: true, manager_email_configured: true, delivery: { verified: false, last_success_at: null, last_attempt_at: '2026-10-30T23:00:00+05:30', last_attempt_status: 'failed', last_error: 'Gmail rejected the login (535). Gmail needs a 16-character App Password' } })
    expect(await screen.findByText(/Gmail rejected the login \(535\)/)).toBeInTheDocument()
    expect(screen.getByText('Real delivery not verified yet')).toBeInTheDocument()
  })

  it('reports verified delivery', async () => {
    open({ backend: 'smtp', delivers_real_email: true, smtp_configured: true, manager_email_configured: true, delivery: { verified: true, last_success_at: new Date().toISOString(), last_attempt_at: new Date().toISOString(), last_attempt_status: 'sent', last_error: null } })
    expect(await screen.findByText(/^Real delivery verified/)).toBeInTheDocument()
  })
})
