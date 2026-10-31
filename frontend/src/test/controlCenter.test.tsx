import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Batch } from '../api/types'
import * as f from './fixtures'
import { mockApi } from './mockApi'
import { renderApp } from './render'

function setup(result: Batch = f.batch(), extra: Record<string, unknown> = {}) {
  return mockApi({
    'GET /api/health': { status: 'ok' },
    'GET /api/dashboard': f.dashboard(),
    'GET /api/control-center/queue': { total: f.queue.length, items: f.queue },
    'GET /api/approvals': (_: unknown, url: URL) => (url.searchParams.get('status') === 'pending' ? [f.request('REQ-1')] : []),
    'GET /api/email/status': f.fileEmail,
    'POST /api/control-center/preview': (body: unknown) => {
      const ids = (body as { item_ids: string[] }).item_ids
      return { mode: 'manual', requested: ids.length, selected_count: ids.length, items: f.queue.filter((i) => ids.includes(i.item_id)), item_ids: ids, warnings: [], email: f.fileEmail }
    },
    'POST /api/control-center/batches': () => ({ status: 201, body: result }),
    'GET ^/api/control-center/batches/': { ...result, requests: [f.request('REQ-10'), f.request('REQ-11', { ticket_id: 'TCK-102' })] },
    ...extra,
  })
}

const summary = () => screen.getByTestId('selection-summary').textContent

describe('Approval Control Center', () => {
  it('groups eligible tickets by priority', async () => {
    setup()
    renderApp('/control-center')
    await screen.findByRole('link', { name: 'TCK-101' })
    expect(screen.getByRole('checkbox', { name: 'Select all P1 Urgent' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select all P2 High' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select all P3 Normal' })).toBeInTheDocument()
    expect(summary()).toBe('0 of 8 eligible tickets selected')
  })

  it('selects Top 5 in ranking order and shows the breakdown', async () => {
    setup()
    renderApp('/control-center')
    await screen.findByRole('link', { name: 'TCK-101' })
    fireEvent.click(screen.getByRole('button', { name: 'Top 5' }))
    expect(summary()).toBe('5 of 8 eligible tickets selected')
    for (const id of ['TCK-101', 'TCK-102', 'TCK-103', 'TCK-104', 'TCK-105']) expect(screen.getByRole('checkbox', { name: `Select ${id}` })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Select TCK-106' })).not.toBeChecked()
    expect(screen.getByText('Top 5 · All eligible priorities')).toBeInTheDocument()
  })

  it('limits Top 10 to P1 only and explains the shortfall', async () => {
    setup()
    renderApp('/control-center')
    await screen.findByRole('link', { name: 'TCK-101' })
    fireEvent.click(screen.getByRole('radio', { name: 'P1 only' }))
    expect(screen.queryByRole('link', { name: 'TCK-104' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Top 10' }))
    expect(summary()).toBe('3 of 8 eligible tickets selected')
    expect(await screen.findByText('Only 3 eligible tickets in P1 only')).toBeInTheDocument()
  })

  it('supports P1 + P2, custom count, manual selection, select all and clear', async () => {
    setup()
    renderApp('/control-center')
    await screen.findByRole('link', { name: 'TCK-101' })
    fireEvent.click(screen.getByRole('radio', { name: 'P1 + P2' }))
    fireEvent.change(screen.getByLabelText('Custom number of tickets'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Select top' }))
    expect(summary()).toBe('4 of 8 eligible tickets selected')

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select TCK-101' }))
    expect(summary()).toBe('3 of 8 eligible tickets selected')

    fireEvent.click(screen.getByRole('button', { name: 'Select all shown' }))
    expect(summary()).toBe('5 of 8 eligible tickets selected')
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(summary()).toBe('0 of 8 eligible tickets selected')
  })

  it('searches the queue', async () => {
    setup()
    renderApp('/control-center')
    await screen.findByRole('link', { name: 'TCK-101' })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search queue' }), { target: { value: 'TCK-107' } })
    expect(screen.getByRole('link', { name: 'TCK-107' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'TCK-101' })).not.toBeInTheDocument()
  })

  it('reviews the selection, then submits one batch and shows honest delivery status', async () => {
    const api = setup()
    renderApp('/control-center')
    await screen.findByRole('link', { name: 'TCK-101' })
    fireEvent.click(screen.getByRole('button', { name: 'Top 5' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review & send' }))

    const review = await screen.findByRole('dialog', { name: 'Review batch before sending' })
    expect(api.callsTo('POST', '/api/control-center/preview')[0].body).toEqual({ mode: 'manual', item_ids: ['REC-1', 'REC-2', 'REC-3', 'REC-4', 'REC-5'] })
    expect(within(review).getByText(/5 of 8 eligible tickets selected/)).toBeInTheDocument()
    expect(within(review).getByText('This email will not be delivered')).toBeInTheDocument()
    expect(api.callsTo('POST', '/api/control-center/batches')).toHaveLength(0)

    fireEvent.change(within(review).getByLabelText(/Note to the manager/), { target: { value: 'Urgent refunds first' } })
    fireEvent.click(within(review).getByRole('button', { name: 'Create batch (file email)' }))

    await waitFor(() => expect(api.callsTo('POST', '/api/control-center/batches')).toHaveLength(1))
    expect(api.callsTo('POST', '/api/control-center/batches')[0].body).toEqual({
      item_ids: ['REC-1', 'REC-2', 'REC-3', 'REC-4', 'REC-5'],
      note: 'Urgent refunds first',
      // All eligible = no priority filter, so no priority list is recorded.
      selection: { mode: 'top', count: 5 },
    })

    const result = await screen.findByRole('dialog', { name: 'Batch BATCH-7 created' })
    expect(within(result).getByText('Saved to outbox')).toBeInTheDocument()
    expect(within(result).queryByText('Sent')).not.toBeInTheDocument()
    expect(await within(result).findByText('REQ-11')).toBeInTheDocument()
  })

  it('reports a failed email instead of success', async () => {
    const failed = f.batch({ status: 'email_failed', emails: [{ ...f.batch().emails[0], status: 'failed', error: 'Could not connect to the SMTP server' }] })
    setup(failed)
    renderApp('/control-center')
    await screen.findByRole('link', { name: 'TCK-101' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select TCK-101' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review & send' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Create batch/ }))
    const result = await screen.findByRole('dialog', { name: 'Batch BATCH-7 created' })
    expect(within(result).getByText('Email failed')).toBeInTheDocument()
    expect(within(result).getByText('Error: Could not connect to the SMTP server')).toBeInTheDocument()
  })

  it('shows the server error when a ticket was already submitted', async () => {
    setup(f.batch(), { 'POST /api/control-center/batches': { status: 409, body: { detail: 'Batch not sent: REC-1 (TCK-101) is submitted.' } } })
    renderApp('/control-center')
    await screen.findByRole('link', { name: 'TCK-101' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select TCK-101' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review & send' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Create batch/ }))
    expect(await screen.findByText('Batch not sent: REC-1 (TCK-101) is submitted.')).toBeInTheDocument()
  })

  it('lists requests already with the manager', async () => {
    setup()
    renderApp('/control-center')
    await screen.findByRole('link', { name: 'TCK-101' })
    fireEvent.click(screen.getByRole('tab', { name: /Awaiting manager/ }))
    expect(await screen.findByText('REQ-1')).toBeInTheDocument()
    expect(screen.getByText('Pending manager')).toBeInTheDocument()
  })
})
