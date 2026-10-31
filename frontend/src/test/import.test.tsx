import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ImportPreview } from '../api/types'
import { mockApi } from './mockApi'
import { renderApp } from './render'

const CSV = 'Case Number;Opened;State;Severity;Requester Email\nC-1;2026-10-30 10:00;Open;P1;a@b.c\nC-2;bad date;Open;P2;a@b.c\n'

function preview(overrides: Partial<ImportPreview> = {}): ImportPreview {
  return {
    filename: 'export.csv',
    delimiter: 'semicolon',
    columns: ['Case Number', 'Opened', 'State', 'Severity', 'Requester Email'],
    row_count: 2,
    sample_rows: [],
    mapping: { ticket_id: 'Case Number', created_at: 'Opened', status: 'State', priority: 'Severity', category: null },
    fields: [
      { field: 'ticket_id', label: 'Ticket ID', required: true },
      { field: 'created_at', label: 'Created date', required: true },
      { field: 'status', label: 'Status', required: true },
      { field: 'priority', label: 'Priority', required: true },
      { field: 'category', label: 'Category', required: false },
    ],
    excluded_sensitive_columns: ['Requester Email'],
    date_formats: ['auto', 'DD/MM/YYYY', 'MM/DD/YYYY'],
    date_format: 'auto',
    ready: true,
    mapping_error: null,
    valid_rows: 1,
    invalid_rows: 1,
    errors: [{ row: 3, ticket_id: 'C-2', field: 'created_at', message: "'bad date' is not a recognised date" }],
    warnings: ['No refund column: the refund over $200 rule cannot be checked.'],
    normalized_sample: [{ ticket_id: 'C-1', created_at: '2026-10-30 10:00', resolved_at: '', status: 'open', priority: 'urgent' }],
    ...overrides,
  }
}

function setup(commit: (body: unknown) => unknown) {
  return mockApi({
    'GET /api/health': { status: 'ok', tickets_loaded: 60 },
    'GET /api/dashboard': { queue: { queued: 0 }, approvals: { by_status: { pending: 0, info_requested: 0 } } },
    'GET /api/imports': { active_file: 'data/tickets_sample.csv', imports: [] },
    'POST /api/imports/preview': (body: unknown) => {
      const mapping = (body as { mapping: Record<string, string | null> | null }).mapping
      return mapping && !mapping.priority ? preview({ mapping, ready: false, mapping_error: 'Map the required fields: Priority.', valid_rows: 0, invalid_rows: null, errors: [], normalized_sample: [] }) : preview(mapping ? { mapping } : {})
    },
    'POST /api/imports': commit,
  })
}

async function upload() {
  const file = new File([CSV], 'export.csv', { type: 'text/csv' })
  fireEvent.change(await screen.findByLabelText('Choose CSV file'), { target: { files: [file] } })
  await screen.findByText('Detected columns')
}

describe('CSV import', () => {
  it('previews the file, shows columns, hidden email column and validation counts', async () => {
    const api = setup(() => ({}))
    renderApp('/import')
    await upload()

    expect(api.callsTo('POST', '/api/imports/preview')[0].body).toMatchObject({ filename: 'export.csv', content: CSV, mapping: null, date_format: 'auto' })
    expect(screen.getByText('Customer contact columns will not be imported')).toBeInTheDocument()
    expect(screen.getByTestId('valid-rows')).toHaveTextContent('1')
    expect(screen.getByTestId('invalid-rows')).toHaveTextContent('1')
    expect(screen.getByText("'bad date' is not a recognised date")).toBeInTheDocument()
    expect(screen.getByLabelText(/^Ticket ID/)).toHaveValue('Case Number')
  })

  it('re-validates when the mapping changes', async () => {
    const api = setup(() => ({}))
    renderApp('/import')
    await upload()
    fireEvent.change(screen.getByLabelText(/^Priority/), { target: { value: '' } })
    expect(await screen.findByText('Map the required fields: Priority.')).toBeInTheDocument()
    expect(api.callsTo('POST', '/api/imports/preview')[1].body).toMatchObject({ mapping: { priority: null } })
    expect(screen.getByRole('button', { name: /Import \d+ tickets/ })).toBeDisabled()
  })

  it('requires skipping invalid rows, confirms, then imports', async () => {
    const api = setup(() => ({ status: 201, body: { import_id: 'IMP-1', filename: 'export.csv', imported_rows: 1, invalid_rows: 1, status: 'completed', analysis: { analysed: 1, detected: 1, added: 1, updated: 0, withdrawn: 0, skipped: 0 } } }))
    renderApp('/import')
    await upload()

    const importButton = screen.getByRole('button', { name: 'Import 1 tickets' })
    expect(importButton).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/Skip the 1 invalid row/))
    expect(importButton).toBeEnabled()
    fireEvent.click(importButton)

    const dialog = await screen.findByRole('dialog', { name: 'Replace the current tickets?' })
    expect(within(dialog).getByText(/60 loaded tickets will be replaced by 1 tickets/)).toBeInTheDocument()
    expect(api.callsTo('POST', '/api/imports')).toHaveLength(0)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import 1 tickets' }))

    await waitFor(() => expect(api.callsTo('POST', '/api/imports')).toHaveLength(1))
    expect(api.callsTo('POST', '/api/imports')[0].body).toMatchObject({ skip_invalid: true, date_format: 'auto', mapping: { ticket_id: 'Case Number' } })
    expect(await screen.findByText('Import IMP-1 completed')).toBeInTheDocument()
  })

  it('reports a failed import and says current tickets are unchanged', async () => {
    setup(() => ({ status: 422, body: { detail: { message: '1 row(s) have errors.' } } }))
    renderApp('/import')
    await upload()
    fireEvent.click(screen.getByLabelText(/Skip the 1 invalid row/))
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 tickets' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Import 1 tickets' }))
    expect(await screen.findByText('1 row(s) have errors.')).toBeInTheDocument()
    expect(screen.getByText('The current tickets are unchanged.')).toBeInTheDocument()
  })

  it('rejects files that are not CSV', async () => {
    const api = setup(() => ({}))
    renderApp('/import')
    fireEvent.change(await screen.findByLabelText('Choose CSV file'), { target: { files: [new File(['x'], 'photo.png')] } })
    expect(await screen.findByText('Choose a .csv file.')).toBeInTheDocument()
    expect(api.callsTo('POST', '/api/imports/preview')).toHaveLength(0)
  })
})
