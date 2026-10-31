import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import * as f from './fixtures'
import { mockApi } from './mockApi'
import { renderApp } from './render'

function routes(extra: Record<string, unknown> = {}) {
  return {
    'GET /api/health': { status: 'ok' },
    'GET /api/dashboard': f.dashboard(),
    'GET /api/tickets': { total: f.tickets.length, generated_at: '', tickets: f.tickets },
    ...extra,
  }
}

function rowIds() {
  const table = screen.getByRole('table')
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('button')[0].textContent)
}

describe('All Tickets', () => {
  it('lists tickets and searches subject, category and assignee', async () => {
    mockApi(routes())
    renderApp('/tickets')
    await screen.findByText('TCK-1')
    expect(rowIds()).toHaveLength(4)

    const search = screen.getByRole('searchbox', { name: 'Search tickets' })
    fireEvent.change(search, { target: { value: 'refund please' } })
    expect(rowIds()).toEqual(['TCK-2'])

    fireEvent.change(search, { target: { value: 'shipping' } })
    expect(rowIds()).toEqual(['TCK-3'])

    fireEvent.change(search, { target: { value: 'nothing-matches' } })
    expect(screen.getByText('No tickets match')).toBeInTheDocument()
  })

  it('filters by priority, assignee and approval status', async () => {
    mockApi(routes())
    renderApp('/tickets')
    await screen.findByText('TCK-1')

    fireEvent.change(screen.getByLabelText('Filter by priority'), { target: { value: 'urgent' } })
    expect(rowIds()).toEqual(['TCK-1'])

    fireEvent.change(screen.getByLabelText('Filter by priority'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Filter by assignee'), { target: { value: 'sam' } })
    expect(rowIds().sort()).toEqual(['TCK-2', 'TCK-4'])

    fireEvent.change(screen.getByLabelText('Filter by approval status'), { target: { value: 'pending' } })
    expect(rowIds()).toEqual(['TCK-4'])
    expect(screen.getByText('1 of 4 tickets match')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(rowIds()).toHaveLength(4)
  })

  it('sorts by priority', async () => {
    mockApi(routes())
    renderApp('/tickets')
    await screen.findByText('TCK-1')
    fireEvent.click(screen.getByRole('button', { name: /Priority/ }))
    expect(rowIds()).toEqual(['TCK-1', 'TCK-2', 'TCK-4', 'TCK-3'])
  })

  it('opens details and requests approval manually', async () => {
    const detail = { ...f.tickets[1], requests: [] }
    const api = mockApi(
      routes({
        'GET /api/tickets/TCK-2': detail,
        'POST /api/control-center/queue': (body: unknown) => ({ status: 201, body: { ...f.queueItem(9, 'high'), ...(body as object) } }),
      }),
    )
    renderApp('/tickets')
    fireEvent.click(await screen.findByText('TCK-2'))

    const drawer = await screen.findByRole('dialog')
    expect(await within(drawer).findByText('Not resolved / not available')).toBeInTheDocument()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Request approval' }))

    const dialog = await screen.findByRole('dialog', { name: 'Request approval for TCK-2' })
    expect(within(dialog).getByLabelText(/Refund amount/)).toHaveValue('450')
    fireEvent.change(within(dialog).getByLabelText(/Reason for the request/), { target: { value: 'Customer escalated' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add to approval queue' }))

    await waitFor(() => expect(api.callsTo('POST', '/api/control-center/queue')).toHaveLength(1))
    expect(api.callsTo('POST', '/api/control-center/queue')[0].body).toEqual({ ticket_id: 'TCK-2', refund_amount: 450, team_account_closing: false, note: 'Customer escalated' })
    expect(await screen.findByText('TCK-2 added to the approval queue')).toBeInTheDocument()
  })

  it('does not allow a second request while one is pending', async () => {
    mockApi(routes({ 'GET /api/tickets/TCK-4': { ...f.tickets[3], requests: [f.request('REQ-1', { ticket_id: 'TCK-4' })] } }))
    renderApp('/tickets?ticket=TCK-4')
    const drawer = await screen.findByRole('dialog')
    expect(await within(drawer).findByRole('button', { name: 'Request approval' })).toBeDisabled()
  })
})
