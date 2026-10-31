import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import * as f from './fixtures'
import { mockApi } from './mockApi'
import { renderApp } from './render'

const PATH = '/api/manager/actions/tok-123'

describe('Manager email action page', () => {
  it('records nothing on open, then decides with one click and the optional comment', async () => {
    const api = mockApi({
      [`GET ${PATH}`]: f.managerOutcome(),
      [`POST ${PATH}`]: (body: unknown) => f.managerOutcome({ state: 'done', request: { ...f.managerOutcome().request!, status: 'approved' }, message: (body as { note: string }).note }),
    })
    renderApp('/act/tok-123')

    expect(await screen.findByRole('heading', { name: 'Approve request' })).toBeInTheDocument()
    expect(screen.getAllByText('TCK-101')).toHaveLength(2) // quick summary by the button + full details
    expect(screen.getByText('$480.00')).toBeInTheDocument()
    expect(api.callsTo('POST', PATH)).toHaveLength(0)

    // Typing a comment is not a decision.
    fireEvent.change(screen.getByLabelText(/Comment \(optional\)/), { target: { value: 'OK to refund' } })
    expect(api.callsTo('POST', PATH)).toHaveLength(0)

    // One explicit click is the confirmation: no extra pop-up, exactly one POST.
    const button = screen.getByRole('button', { name: 'Confirm approval' })
    fireEvent.click(button)
    fireEvent.click(button) // a double-click must not send twice
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(api.callsTo('POST', PATH)).toHaveLength(1))
    expect(api.callsTo('POST', PATH)[0].body).toEqual({ confirm: true, note: 'OK to refund' })
    expect(await screen.findByRole('heading', { name: 'Request approved' })).toBeInTheDocument()
    expect(api.callsTo('POST', PATH)).toHaveLength(1) // still one after everything settled
  })

  it('sends no admin key from the manager page', async () => {
    sessionStorage.setItem('ticketflow.adminKey', 'secret')
    const api = mockApi({ [`GET ${PATH}`]: f.managerOutcome() })
    renderApp('/act/tok-123')
    await screen.findByRole('heading', { name: 'Approve request' })
    const init = (api.fetchMock.mock.calls as unknown as [string, RequestInit][])[0][1]
    expect((init.headers as Record<string, string>)['X-Admin-Key']).toBeUndefined()
  })

  it('needs a note before asking for more information', async () => {
    mockApi({ [`GET ${PATH}`]: f.managerOutcome({ action: 'need_more_info', note_required: true }) })
    renderApp('/act/tok-123')
    const button = await screen.findByRole('button', { name: 'Send request for information' })
    expect(button).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/What information do you need/), { target: { value: 'Invoice number?' } })
    expect(button).toBeEnabled()
  })

  it('rejects with one click and an optional comment', async () => {
    const api = mockApi({
      [`GET ${PATH}`]: f.managerOutcome({ action: 'reject' }),
      [`POST ${PATH}`]: f.managerOutcome({ state: 'done', action: 'reject', request: { ...f.managerOutcome().request!, status: 'rejected' } }),
    })
    renderApp('/act/tok-123')
    fireEvent.change(await screen.findByLabelText(/Comment \(optional\)/), { target: { value: 'Over budget' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm rejection' }))
    await waitFor(() => expect(api.callsTo('POST', PATH)).toHaveLength(1))
    expect(api.callsTo('POST', PATH)[0].body).toEqual({ confirm: true, note: 'Over budget' })
    expect(await screen.findByRole('heading', { name: 'Request rejected' })).toBeInTheDocument()
  })

  it('approves with one click and no comment', async () => {
    const api = mockApi({
      [`GET ${PATH}`]: f.managerOutcome(),
      [`POST ${PATH}`]: f.managerOutcome({ state: 'done' }),
    })
    renderApp('/act/tok-123')
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm approval' }))
    await waitFor(() => expect(api.callsTo('POST', PATH)).toHaveLength(1))
    expect(api.callsTo('POST', PATH)[0].body).toEqual({ confirm: true, note: '' })
  })

  it.each([
    ['expired', 410, 'This link has expired'],
    ['used', 409, 'This link has already been used'],
    ['revoked', 409, 'This link is no longer active'],
    ['decided', 409, 'This request was already decided'],
    ['invalid', 404, 'This link is not valid'],
  ])('shows a clear message for a %s link', async (state, status, title) => {
    mockApi({ [`GET ${PATH}`]: { status, body: f.managerOutcome({ state: state as never, request: state === 'invalid' ? null : f.managerOutcome().request }) } })
    renderApp('/act/tok-123')
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Confirm/ })).not.toBeInTheDocument()
  })

  it('shows the used-link message when the link was used in the meantime', async () => {
    mockApi({
      [`GET ${PATH}`]: f.managerOutcome(),
      [`POST ${PATH}`]: { status: 409, body: f.managerOutcome({ state: 'used', message: 'This link has already been used.' }) },
    })
    renderApp('/act/tok-123')
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm approval' }))
    expect(await screen.findByRole('heading', { name: 'This link has already been used' })).toBeInTheDocument()
  })
})
