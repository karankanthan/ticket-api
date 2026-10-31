import { useRef, useState, type DragEvent } from 'react'
import { AlertTriangle, CheckCircle2, EyeOff, FileSpreadsheet, FileUp, History, RefreshCw, Upload, XCircle } from 'lucide-react'
import { ApiError } from '../api/client'
import { api } from '../api/endpoints'
import type { ColumnMapping, ImportEntry, ImportPreview } from '../api/types'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, CardBody, CardHeader } from '../components/ui/Card'
import { ConfirmDialog } from '../components/ui/Dialog'
import { EmptyState, ErrorState, InlineAlert, SkeletonRows } from '../components/ui/Feedback'
import { Checkbox, Select } from '../components/ui/Form'
import { PageHeader } from '../components/ui/Layout'
import { useToast } from '../components/ui/toastContext'
import { broadcastRefresh, useApi } from '../hooks/useApi'
import { cx, formatDateTime } from '../lib/format'
import { TD, TH } from '../lib/table'

const MAX_BYTES = 10 * 1024 * 1024
// raised_by_email arrives masked from the backend (e.g. a***@company.com).
const PREVIEW_COLUMNS = ['ticket_id', 'created_at', 'resolved_at', 'status', 'priority', 'category', 'assigned_to', 'raised_by_email', 'refund_amount', 'subject']

interface UploadedFile {
  filename: string
  content: string
}

export default function ImportPage() {
  const toast = useToast()
  const history = useApi((signal) => api.importHistory(signal), [])
  const tickets = useApi((signal) => api.health(signal), [])
  const input = useRef<HTMLInputElement>(null)
  const [upload, setUpload] = useState<UploadedFile | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping | null>(null)
  const [dateFormat, setDateFormat] = useState('auto')
  const [skipInvalid, setSkipInvalid] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [result, setResult] = useState<ImportEntry | null>(null)

  async function runPreview(next: UploadedFile, nextMapping: ColumnMapping | null, nextDateFormat: string) {
    setLoading(true)
    setError('')
    try {
      const response = await api.importPreview({ filename: next.filename, content: next.content, mapping: nextMapping, date_format: nextDateFormat })
      setPreview(response)
      setMapping(response.mapping)
    } catch (err) {
      setPreview(null)
      setError(err instanceof ApiError ? err.message : 'The file could not be checked.')
    } finally {
      setLoading(false)
    }
  }

  async function handleFile(file: File | undefined) {
    if (!file) return
    setResult(null)
    if (!/\.(csv|txt)$/i.test(file.name)) {
      setError('Choose a .csv file.')
      return
    }
    if (file.size > MAX_BYTES) {
      setError('The file is larger than 10 MB.')
      return
    }
    const next = { filename: file.name, content: await file.text() }
    setUpload(next)
    setSkipInvalid(false)
    setDateFormat('auto')
    await runPreview(next, null, 'auto')
  }

  function changeMapping(field: string, column: string) {
    if (!upload || !mapping) return
    const next = { ...mapping, [field]: column || null }
    setMapping(next)
    void runPreview(upload, next, dateFormat)
  }

  function changeDateFormat(value: string) {
    setDateFormat(value)
    if (upload) void runPreview(upload, mapping, value)
  }

  function reset() {
    setUpload(null)
    setPreview(null)
    setMapping(null)
    setError('')
    if (input.current) input.current.value = ''
  }

  async function commit() {
    if (!upload || !mapping) return
    setCommitting(true)
    try {
      const entry = await api.importCommit({ filename: upload.filename, content: upload.content, mapping, date_format: dateFormat, skip_invalid: skipInvalid })
      setResult(entry)
      toast({ tone: 'success', title: `Imported ${entry.imported_rows} tickets`, description: entry.analysis ? `${entry.analysis.added} added to the approval queue.` : undefined })
      reset()
      broadcastRefresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import failed.')
      toast({ tone: 'error', title: 'Import failed', description: 'The current tickets are unchanged.' })
      history.reload()
    } finally {
      setCommitting(false)
      setConfirming(false)
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    void handleFile(event.dataTransfer.files[0])
  }

  const invalid = preview?.invalid_rows ?? 0
  const canImport = !!preview && preview.ready && !loading && (invalid === 0 || skipInvalid)
  const current = tickets.data?.tickets_loaded

  return (
    <>
      <PageHeader
        title="CSV Import"
        description="Upload a helpdesk export, map its columns and check every row before replacing the current tickets. If an import fails, the current tickets stay in place."
      />

      {result && (
        <div className="mb-6">
          <InlineAlert tone="success" icon={<CheckCircle2 className="size-4" />} title={`Import ${result.import_id} completed`}>
            {result.imported_rows} tickets imported from {result.filename}
            {result.invalid_rows ? `, ${result.invalid_rows} invalid rows skipped` : ''}.{' '}
            {result.analysis && `${result.analysis.detected} tickets need approval; ${result.analysis.added} were added to the approval queue.`}
          </InlineAlert>
        </div>
      )}

      {!upload ? (
        <Card>
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cx('m-5 flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors', dragging ? 'border-brand-400 bg-brand-50' : 'border-slate-300 bg-slate-50/50')}
          >
            <div className="mb-4 rounded-full bg-brand-100 p-3 text-brand-600">
              <FileUp className="size-6" />
            </div>
            <p className="text-sm font-semibold text-slate-900">Drop a CSV export here, or choose a file</p>
            <p className="mt-1 max-w-md text-sm text-slate-500">
              Works with different helpdesk exports: comma, semicolon or tab separated. Columns are detected automatically and can be changed before importing.
            </p>
            <label className="mt-5">
              <span className="sr-only">Choose CSV file</span>
              <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void handleFile(e.target.files?.[0])} aria-label="Choose CSV file" />
              <span className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-brand-700">
                <Upload className="size-4" /> Choose file
              </span>
            </label>
            {current !== undefined && <p className="mt-4 text-xs text-slate-400">Currently loaded: {current} tickets</p>}
          </div>
          {error && (
            <div className="px-5 pb-5">
              <InlineAlert tone="error">{error}</InlineAlert>
            </div>
          )}
        </Card>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader
              icon={<FileSpreadsheet className="size-4" />}
              title={upload.filename}
              description={preview ? `${preview.row_count} rows · ${preview.columns.length} columns · ${preview.delimiter} separated` : 'Checking file…'}
              action={
                <Button size="sm" variant="ghost" onClick={reset}>
                  Choose another file
                </Button>
              }
            />
            {error && (
              <div className="p-5">
                <InlineAlert tone="error">{error}</InlineAlert>
              </div>
            )}
            {preview && (
              <CardBody className="space-y-5">
                <div>
                  <p className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">Detected columns</p>
                  <div className="flex flex-wrap gap-1.5">
                    {preview.columns.map((c) => {
                      const used = Object.values(preview.mapping).includes(c)
                      const hidden = preview.excluded_sensitive_columns.includes(c)
                      return (
                        <Badge key={c} className={hidden ? 'bg-amber-50 text-amber-800 ring-amber-600/20' : used ? 'bg-brand-50 text-brand-700 ring-brand-600/20' : 'bg-white text-slate-500 ring-slate-300'}>
                          {hidden && <EyeOff className="size-3" />}
                          {c}
                        </Badge>
                      )
                    })}
                  </div>
                </div>
                {preview.excluded_sensitive_columns.length > 0 && (
                  <InlineAlert tone="warning" icon={<EyeOff className="size-4" />} title="Customer contact columns will not be imported">
                    {preview.excluded_sensitive_columns.join(', ')} {preview.excluded_sensitive_columns.length === 1 ? 'is' : 'are'} hidden in the preview and left out of the saved data.
                  </InlineAlert>
                )}
              </CardBody>
            )}
          </Card>

          {preview && mapping && (
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
              <Card className="xl:col-span-2">
                <CardHeader title="Column mapping" description="Match your file's columns to TicketFlow fields." />
                <CardBody className="space-y-3">
                  {preview.fields.map((f) => (
                    <div key={f.field} className="grid grid-cols-5 items-center gap-3">
                      <label htmlFor={`map-${f.field}`} className="col-span-2 text-sm text-slate-700">
                        {f.label}
                        {f.required && <span className="ml-0.5 text-red-600">*</span>}
                      </label>
                      <Select id={`map-${f.field}`} className="col-span-3" value={mapping[f.field] ?? ''} onChange={(e) => changeMapping(f.field, e.target.value)} disabled={loading}>
                        <option value="">{f.required ? 'Choose a column…' : 'Not in this file'}</option>
                        {preview.columns
                          .filter((c) => !preview.excluded_sensitive_columns.includes(c))
                          .map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                      </Select>
                    </div>
                  ))}
                  <div className="grid grid-cols-5 items-center gap-3 border-t border-slate-100 pt-3">
                    <label htmlFor="date-format" className="col-span-2 text-sm text-slate-700">
                      Date format
                    </label>
                    <Select id="date-format" className="col-span-3" value={dateFormat} onChange={(e) => changeDateFormat(e.target.value)} disabled={loading}>
                      <option value="auto">Automatic (YYYY-MM-DD, ISO)</option>
                      <option value="DD/MM/YYYY">DD/MM/YYYY (day first)</option>
                      <option value="MM/DD/YYYY">MM/DD/YYYY (month first)</option>
                    </Select>
                  </div>
                </CardBody>
              </Card>

              <Card className="xl:col-span-3">
                <CardHeader title="Validation" description={loading ? 'Re-checking with the new mapping…' : 'Every row is checked before anything is saved.'} />
                <CardBody className="space-y-4">
                  {preview.mapping_error ? (
                    <InlineAlert tone="error" icon={<XCircle className="size-4" />}>
                      {preview.mapping_error}
                    </InlineAlert>
                  ) : (
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-lg bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">Rows in file</p>
                        <p className="tabular text-2xl font-semibold">{preview.row_count}</p>
                      </div>
                      <div className="rounded-lg bg-emerald-50 p-3">
                        <p className="text-xs text-emerald-700">Valid rows</p>
                        <p className="tabular text-2xl font-semibold text-emerald-800" data-testid="valid-rows">
                          {preview.valid_rows}
                        </p>
                      </div>
                      <div className={cx('rounded-lg p-3', invalid ? 'bg-red-50' : 'bg-slate-50')}>
                        <p className={cx('text-xs', invalid ? 'text-red-700' : 'text-slate-500')}>Invalid rows</p>
                        <p className={cx('tabular text-2xl font-semibold', invalid ? 'text-red-800' : '')} data-testid="invalid-rows">
                          {invalid}
                        </p>
                      </div>
                    </div>
                  )}
                  {preview.warnings.map((w) => (
                    <InlineAlert key={w} tone="info">
                      {w}
                    </InlineAlert>
                  ))}
                  {preview.errors.length > 0 && (
                    <div className="max-h-64 overflow-auto rounded-lg border border-red-100">
                      <table className="min-w-full text-sm">
                        <thead className="sticky top-0 bg-red-50">
                          <tr>
                            <th className={TH}>Row</th>
                            <th className={TH}>Ticket</th>
                            <th className={TH}>Field</th>
                            <th className={TH}>Problem</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-red-50">
                          {preview.errors.map((e, i) => (
                            <tr key={i}>
                              <td className={cx(TD, 'tabular')}>{e.row}</td>
                              <td className={cx(TD, 'font-mono')}>{e.ticket_id || '—'}</td>
                              <td className={TD}>{e.field}</td>
                              <td className={TD}>{e.message}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {preview.errors_truncated && <p className="p-2 text-xs text-slate-500">Only the first errors are shown.</p>}
                    </div>
                  )}
                  {invalid > 0 && preview.valid_rows > 0 && (
                    <Checkbox label={`Skip the ${invalid} invalid row${invalid === 1 ? '' : 's'} and import the rest`} checked={skipInvalid} onChange={(e) => setSkipInvalid(e.target.checked)} />
                  )}
                  <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 pt-4">
                    {!canImport && preview.ready && invalid > 0 && !skipInvalid && <span className="text-sm text-slate-500">Fix the file or choose to skip invalid rows.</span>}
                    <Button variant="primary" disabled={!canImport} onClick={() => setConfirming(true)} icon={<Upload className="size-4" />}>
                      Import {preview.valid_rows} tickets
                    </Button>
                  </div>
                </CardBody>
              </Card>
            </div>
          )}

          {preview && preview.normalized_sample.length > 0 && (
            <Card>
              <CardHeader title="Preview of imported data" description="First rows after mapping and clean-up, exactly as they will be saved." />
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100">
                  <thead className="bg-slate-50/70">
                    <tr>
                      {PREVIEW_COLUMNS.map((h) => (
                        <th key={h} className={TH}>
                          {h === 'raised_by_email' ? 'raised by (employee)' : h.replace('_', ' ')}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.normalized_sample.map((row) => (
                      <tr key={row.ticket_id}>
                        {PREVIEW_COLUMNS.map((h) => (
                          <td key={h} className={cx(TD, 'whitespace-nowrap', h === 'ticket_id' && 'font-mono')}>
                            {row[h] || <span className="text-slate-300">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      <Card className="mt-6">
        <CardHeader
          icon={<History className="size-4" />}
          title="Import history"
          description={history.data ? `Active data file: ${history.data.active_file}` : undefined}
          action={
            <Button size="sm" variant="ghost" onClick={history.reload} icon={<RefreshCw className="size-3.5" />}>
              Refresh
            </Button>
          }
        />
        {history.error && !history.data ? (
          <ErrorState compact error={history.error} onRetry={history.reload} />
        ) : !history.data ? (
          <SkeletonRows rows={3} />
        ) : history.data.imports.length === 0 ? (
          <EmptyState title="No uploads yet" description="Tickets are currently loaded from the configured CSV file." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50/70">
                <tr>
                  <th className={TH}>Import</th>
                  <th className={TH}>File</th>
                  <th className={TH}>When</th>
                  <th className={TH}>Result</th>
                  <th className={TH}>Rows</th>
                  <th className={TH}>Approval queue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.data.imports.map((e) => (
                  <tr key={e.import_id}>
                    <td className={cx(TD, 'font-mono')}>{e.import_id}</td>
                    <td className={TD}>{e.filename}</td>
                    <td className={cx(TD, 'whitespace-nowrap')}>{formatDateTime(e.created_at)}</td>
                    <td className={TD}>
                      {e.status === 'completed' ? (
                        <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-600/20">
                          <CheckCircle2 className="size-3" /> Completed
                        </Badge>
                      ) : (
                        <span title={e.error ?? undefined}>
                          <Badge className="bg-red-50 text-red-700 ring-red-600/20">
                            <AlertTriangle className="size-3" /> Failed
                          </Badge>
                          {e.error && <p className="mt-1 max-w-xs truncate text-xs text-slate-500">{e.error}</p>}
                        </span>
                      )}
                    </td>
                    <td className={cx(TD, 'tabular')}>
                      {e.status === 'completed' ? `${e.imported_rows} imported` : '—'}
                      {e.invalid_rows ? <span className="text-slate-400"> · {e.invalid_rows} invalid</span> : null}
                    </td>
                    <td className={cx(TD, 'tabular')}>{e.analysis ? `${e.analysis.added} added` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={confirming}
        title="Replace the current tickets?"
        confirmLabel={`Import ${preview?.valid_rows ?? 0} tickets`}
        loading={committing}
        onCancel={() => setConfirming(false)}
        onConfirm={commit}
      >
        <p className="text-sm text-slate-600">
          The {current ?? 'current'} loaded tickets will be replaced by {preview?.valid_rows} tickets from <strong>{upload?.filename}</strong>
          {skipInvalid && invalid ? ` (${invalid} invalid rows skipped)` : ''}. Existing approval requests and history are kept. The new tickets are analysed and any that need approval are added to the queue. Nothing is emailed.
        </p>
      </ConfirmDialog>
    </>
  )
}
