import '@testing-library/jest-dom/vitest'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App'

describe('Ticket Triage page', () => {
  it('renders the ticket form and submit button', () => {
    render(<App />)

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
