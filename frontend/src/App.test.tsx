import '@testing-library/jest-dom/vitest'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import TriagePage from './pages/TriagePage'

// The triage form moved from App to its own page (App is now the TicketFlow router).
describe('Ticket Triage page', () => {
  it('renders the ticket form and submit button', () => {
    render(<TriagePage />)

    expect(
      screen.getByRole('heading', { name: 'Ticket Triage' }),
    ).toBeInTheDocument()

    expect(
      screen.getByLabelText('Ticket subject'),
    ).toBeInTheDocument()

    expect(
      screen.getByLabelText('Customer message'),
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: 'Triage ticket' }),
    ).toBeInTheDocument()
  })
})
