import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import * as f from './fixtures'
import { mockApi } from './mockApi'
import { renderApp } from './render'

describe('Employee notifications in Approval History', () => {
  it('shows sent, skipped (with reason) and failed notices with masked addresses only', async () => {
    const sent = f.request('REQ-1', {
      ticket_id: 'TCK-101', status: 'approved', note: 'OK', employee_email: 'a***@company.com',
      employee_notifications: [{ decision: 'approved', recipient: 'a***@company.com', status: 'sent', reason: null, error: null, at: '2026-10-31T10:00:00+05:30' }],
    })
    const skipped = f.request('REQ-2', {
      ticket_id: 'TCK-102', status: 'rejected', employee_email: '',
      employee_notifications: [{ decision: 'rejected', recipient: '', status: 'skipped', reason: 'no employee email for this ticket (the import has no raised-by email for it)', error: null, at: '2026-10-31T10:01:00+05:30' }],
    })
    const failed = f.request('REQ-3', {
      ticket_id: 'TCK-103', status: 'info_requested', employee_email: 'b***@company.com',
      employee_notifications: [{ decision: 'info_requested', recipient: 'b***@company.com', status: 'failed', reason: null, error: 'Gmail rejected the login (535).', at: '2026-10-31T10:02:00+05:30' }],
    })
    mockApi({ 'GET /api/health': { status: 'ok' }, 'GET /api/dashboard': f.dashboard(), 'GET /api/approvals': [sent, skipped, failed] })
    renderApp('/approvals')

    fireEvent.click(await screen.findByRole('button', { name: 'REQ-1' }))
    let notices = within(await screen.findByTestId('employee-notifications'))
    expect(notices.getByText('Sent')).toBeInTheDocument()
    expect(notices.getByText('Approved notice to a***@company.com')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    fireEvent.click(screen.getByRole('button', { name: 'REQ-2' }))
    notices = within(await screen.findByTestId('employee-notifications'))
    expect(notices.getByText('Not sent')).toBeInTheDocument()
    expect(notices.getByText(/Skipped: no employee email for this ticket/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    fireEvent.click(screen.getByRole('button', { name: 'REQ-3' }))
    notices = within(await screen.findByTestId('employee-notifications'))
    expect(notices.getByText('Failed')).toBeInTheDocument()
    expect(notices.getByText('Gmail rejected the login (535).')).toBeInTheDocument()
  })
})
