import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Priority, Ticket } from '../api/types'
import * as f from './fixtures'
import { mockApi } from './mockApi'
import { renderApp } from './render'

const PRIORITIES: Priority[] = ['urgent', 'high', 'normal', 'low']
const STATUSES = ['open', 'in_progress', 'resolved', 'closed']

// 120 tickets as /api/tickets returns them. GEN-001 is with the manager, GEN-002 is in the eligible queue.
function tickets(n = 120): Ticket[] {
  return Array.from({ length: n }, (_, k) => {
    const i = k + 1
    const id = `GEN-${String(i).padStart(3, '0')}`
    const approval =
      i === 1
        ? { status: 'pending' as const, request_id: 'REQ-1', batch_id: 'BATCH-1', decided_at: null, queue_item_id: null, queue_reasons: [] }
        : i === 2
          ? { status: 'queued' as const, request_id: null, batch_id: null, decided_at: null, queue_item_id: 'REC-2', queue_reasons: ['urgent ticket'] }
          : { status: 'none' as const, request_id: null, batch_id: null, decided_at: null, queue_item_id: null, queue_reasons: [] }
    return f.ticket(id, { priority: PRIORITIES[i % 4], status: STATUSES[i % 4], category: `Cat${i % 5}`, subject: `Subject ${i}`, refund_amount: i % 3 ? null : 50 * i, approval })
  })
}

function setup(extra: Record<string, unknown> = {}) {
  const list = tickets()
  return mockApi({
    'GET /api/health': { status: 'ok' },
    'GET /api/dashboard': f.dashboard({ tickets: { total: list.length, by_status: {}, by_priority: {} } }),
    'GET /api/tickets': { total: list.length, generated_at: '', tickets: list },
    'GET /api/control-center/queue': { total: 1, items: [f.queueItem(2, 'urgent', { ticket_id: 'GEN-002', item_id: 'REC-2' })] },
    'GET /api/approvals': (_: unknown, url: URL) => {
      const status = url.searchParams.get('status')
      const waiting = f.request('REQ-1', { ticket_id: 'GEN-001', delivery: { kind: 'initial', status: 'sent', delivered: true, error: null, at: '2026-10-31T09:00:00+05:30' } })
      const decided = f.request('REQ-0', {
        ticket_id: 'GEN-050', status: 'rejected', decided_at: '2026-10-31T10:00:00+05:30', batch_id: 'BATCH-0',
        history: [
          { event: 'created', status: 'pending', via: 'control_center', note: null, at: '2026-10-31T08:00:00+05:30' },
          { event: 'reject', status: 'rejected', via: 'email', note: 'Not covered by policy', at: '2026-10-31T10:00:00+05:30' },
        ],
        delivery: { kind: 'initial', status: 'saved_to_outbox', delivered: false, error: null, at: '2026-10-31T08:00:00+05:30' },
      })
      if (status === 'pending') return [waiting]
      if (status) return []
      return [waiting, decided]
    },
    'GET /api/email/status': f.fileEmail,
    'POST /api/control-center/batches': (body: unknown) => ({ status: 201, body: f.batch({ batch_id: 'BATCH-9', total: (body as { ticket_ids: string[] }).ticket_ids.length }) }),
    'GET ^/api/control-center/batches/': { ...f.batch({ batch_id: 'BATCH-9' }), requests: [] },
    'GET ^/api/tickets/': (_: unknown, url: URL) => ({ ...list.find((t) => url.pathname.endsWith(t.ticket_id))!, requests: [] }),
    ...extra,
  })
}

const countText = () => screen.getByTestId('all-tickets-count').textContent
const rowIds = () =>
  within(screen.getAllByRole('table')[0])
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getAllByRole('button')[0].textContent)

async function openAllTickets() {
  renderApp('/control-center?tab=all')
  // Default sort is by priority (urgent first), so wait for the count rather than a particular row.
  await waitFor(() => expect(screen.getByTestId('all-tickets-count')).toHaveTextContent('imported tickets'))
}

describe('Control Center: All tickets', () => {
  it('shows every imported ticket with the count from the backend', async () => {
    setup()
    await openAllTickets()
    expect(countText()).toBe('120 imported tickets')
    expect(rowIds()).toHaveLength(20)
    expect(rowIds().every((id) => Number(id!.slice(4)) % 4 === 0)).toBe(true) // urgent first
    expect(screen.getByRole('tab', { name: /All tickets/ })).toHaveTextContent('120')
    expect(screen.getByText('Showing 1–20 of 120')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('Showing 21–40 of 120')).toBeInTheDocument()
  })

  it('searches and filters by priority, status and category', async () => {
    setup()
    await openAllTickets()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search all tickets' }), { target: { value: 'GEN-077' } })
    expect(rowIds()).toEqual(['GEN-077'])
    expect(countText()).toBe('120 imported tickets · 1 match')
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))

    fireEvent.change(screen.getByLabelText('Filter all tickets by priority'), { target: { value: 'low' } })
    expect(countText()).toBe('120 imported tickets · 30 match')
    fireEvent.change(screen.getByLabelText('Filter all tickets by status'), { target: { value: 'closed' } })
    expect(countText()).toBe('120 imported tickets · 30 match') // i % 4 === 3 is both low and closed
    fireEvent.change(screen.getByLabelText('Filter all tickets by category'), { target: { value: 'Cat0' } })
    expect(rowIds().every((id) => Number(id!.slice(4)) % 5 === 0)).toBe(true)
  })

  it('cannot select a ticket already with the manager', async () => {
    setup()
    await openAllTickets()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search all tickets' }), { target: { value: 'GEN-001' } })
    expect(screen.getByRole('checkbox', { name: 'Select GEN-001' })).toBeDisabled()
  })

  it('requests approval for an ineligible ticket and a queued one in one batch', async () => {
    const api = setup()
    await openAllTickets()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search all tickets' }), { target: { value: 'GEN-00' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select GEN-003' })) // no approval rule
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select GEN-002' })) // in the eligible queue
    expect(screen.getByTestId('all-tickets-selection')).toHaveTextContent('2 tickets selected for manager approval')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select GEN-002' }))
    expect(screen.getByTestId('all-tickets-selection')).toHaveTextContent('1 ticket selected')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select GEN-002' }))

    fireEvent.click(screen.getByRole('button', { name: 'Review & send' }))
    const review = await screen.findByRole('dialog', { name: 'Review approval request' })
    expect(within(review).getByText('Manual request (no automatic rule)')).toBeInTheDocument()
    expect(within(review).getByText('Urgent ticket')).toBeInTheDocument()
    expect(api.callsTo('POST', '/api/control-center/batches')).toHaveLength(0)
    fireEvent.change(within(review).getByLabelText(/Note to the manager/), { target: { value: 'Please check' } })
    fireEvent.click(within(review).getByRole('button', { name: 'Create batch (file email)' }))

    await waitFor(() => expect(api.callsTo('POST', '/api/control-center/batches')).toHaveLength(1))
    expect(api.callsTo('POST', '/api/control-center/batches')[0].body).toEqual({ ticket_ids: ['GEN-002', 'GEN-003'], note: 'Please check' })
    expect(await screen.findByRole('dialog', { name: 'Batch BATCH-9 created' })).toBeInTheDocument()
  })

  it('shows the server refusal for a duplicate request', async () => {
    setup({ 'POST /api/control-center/batches': { status: 409, body: { detail: 'Batch not sent: GEN-003 already has an open request with the manager (REQ-7).' } } })
    await openAllTickets()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search all tickets' }), { target: { value: 'GEN-003' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select GEN-003' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review & send' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Create batch/ }))
    expect(await screen.findByText('Batch not sent: GEN-003 already has an open request with the manager (REQ-7).')).toBeInTheDocument()
  })

  it('opens ticket details', async () => {
    setup()
    await openAllTickets()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search all tickets' }), { target: { value: 'GEN-001' } })
    fireEvent.click(screen.getByRole('button', { name: 'GEN-001' }))
    expect(await screen.findByRole('dialog', { name: 'GEN-001' })).toBeInTheDocument()
  })
})

describe('Control Center: Awaiting manager', () => {
  it('shows waiting requests, then everything sent with decision, comment and email status', async () => {
    setup()
    renderApp('/control-center?tab=awaiting')
    const row = (await screen.findByText('REQ-1')).closest('tr')!
    expect(within(row).getByText('GEN-001')).toBeInTheDocument()
    expect(within(row).getByText('BATCH-1')).toBeInTheDocument()
    expect(within(row).getByText('Sent')).toBeInTheDocument()
    expect(screen.queryByText('REQ-0')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'All sent' }))
    const decided = (await screen.findByText('REQ-0')).closest('tr')!
    expect(within(decided).getByText('Rejected')).toBeInTheDocument()
    expect(within(decided).getByText('“Not covered by policy”')).toBeInTheDocument()
    expect(within(decided).getByText('Saved to outbox')).toBeInTheDocument()
  })
})

describe('Immediate updates', () => {
  it('a decision on the action page tells other TicketFlow tabs to refresh', async () => {
    expect(typeof BroadcastChannel).toBe('function')
    const received: unknown[] = []
    const listener = new BroadcastChannel('ticketflow')
    listener.onmessage = (event) => received.push(event.data)
    mockApi({
      'GET /api/manager/actions/tok-1': f.managerOutcome(),
      'POST /api/manager/actions/tok-1': f.managerOutcome({ state: 'done' }),
    })
    renderApp('/act/tok-1')
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm approval' }))
    await screen.findByRole('heading', { name: 'Request approved' })
    await waitFor(() => expect(received).toEqual(['refresh']))
    listener.close()
  })
})
