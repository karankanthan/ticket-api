import { useMemo, useState } from 'react'
import { CheckSquare, FilterX, Mail, Send, Square, Ticket as TicketIcon } from 'lucide-react'
import { ApiError } from '../api/client'
import { api } from '../api/endpoints'
import type { Batch, EmailStatus, Ticket } from '../api/types'
import { broadcastRefresh, useApi } from '../hooks/useApi'
import { ageHours, cx, formatHours, formatMoney } from '../lib/format'
import { PRIORITIES, TICKET_STATUS_META, priorityMeta, reasonLabel } from '../lib/meta'
import { TD, TH } from '../lib/table'
import { NO_FILTERS, filterTickets, sortTickets, type TicketFilters } from '../lib/tickets'
import { TicketDrawer } from './TicketDrawer'
import { ApprovalBadge, Badge, PriorityBadge, SlaBadge, TicketStatusBadge } from './ui/Badge'
import { Button } from './ui/Button'
import { Card, CardBody } from './ui/Card'
import { Modal } from './ui/Dialog'
import { EmptyState, ErrorState, InlineAlert, SkeletonRows } from './ui/Feedback'
import { Checkbox, Label, SearchInput, Select, Textarea } from './ui/Form'
import { Pagination } from './ui/Layout'
import { useToast } from './ui/toastContext'

const PAGE_SIZE = 20
/** Tickets whose request is already with the manager cannot be sent again. */
const WITH_MANAGER = new Set(['pending', 'info_requested'])

function blockedReason(ticket: Ticket): string | null {
  return WITH_MANAGER.has(ticket.approval.status) ? `Already with the manager (${ticket.approval.request_id})` : null
}

function approvalReason(ticket: Ticket): string {
  if (ticket.approval.queue_reasons.length) return ticket.approval.queue_reasons.map(reasonLabel).join(', ')
  return 'Manual request (no automatic rule)'
}

/**
 * Every imported ticket. The Helpdesk Head can pick any of them, eligible or not,
 * review the selection and send one consolidated email to the manager.
 */
export function AllTicketsPanel({ email, onBatchCreated }: { email: EmailStatus | undefined; onBatchCreated: (batch: Batch) => void }) {
  const toast = useToast()
  const tickets = useApi((signal) => api.tickets(signal), [], { pollMs: 30_000 })
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<TicketFilters>(NO_FILTERS)
  const [sort, setSort] = useState<'priority' | 'newest' | 'oldest' | 'sla'>('priority')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openId, setOpenId] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')

  const all = useMemo(() => tickets.data?.tickets ?? [], [tickets.data])
  const byId = useMemo(() => new Map(all.map((t) => [t.ticket_id, t])), [all])
  const categories = useMemo(() => [...new Set(all.map((t) => t.category).filter(Boolean))].sort(), [all])
  const rows = useMemo(() => {
    const filtered = filterTickets(all, query, filters)
    if (sort === 'newest') return sortTickets(filtered, 'created_at', 'desc')
    if (sort === 'oldest') return sortTickets(filtered, 'created_at', 'asc')
    if (sort === 'sla') return sortTickets(filtered, 'sla', 'asc')
    return sortTickets(filtered, 'priority', 'asc')
  }, [all, query, filters, sort])

  // Tickets that went to the manager in the meantime silently leave the selection.
  const selection = useMemo(() => new Set([...selected].filter((id) => byId.has(id) && !blockedReason(byId.get(id)!))), [selected, byId])
  const chosen = all.filter((t) => selection.has(t.ticket_id))
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const current = Math.min(page, pages)
  const visible = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  const selectable = visible.filter((t) => !blockedReason(t))
  const pageSelected = selectable.length > 0 && selectable.every((t) => selection.has(t.ticket_id))
  const active = query !== '' || Object.values(filters).some(Boolean)

  function setFilter(key: keyof TicketFilters, value: string) {
    setFilters((f) => ({ ...f, [key]: value }))
    setPage(1)
  }

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function togglePage() {
    setSelected((s) => {
      const next = new Set(s)
      selectable.forEach((t) => (pageSelected ? next.delete(t.ticket_id) : next.add(t.ticket_id)))
      return next
    })
  }

  async function send() {
    setSending(true)
    setSendError('')
    try {
      const batch = await api.submitTicketsBatch(chosen.map((t) => t.ticket_id), note.trim() || null)
      setReviewing(false)
      setSelected(new Set())
      setNote('')
      if (batch.status === 'email_failed') toast({ tone: 'error', title: `${batch.batch_id} created, but the email failed`, description: 'The manager has not been notified.' })
      else if (batch.status === 'sent') toast({ tone: 'success', title: `${batch.batch_id} sent to the manager`, description: `${batch.total} ticket(s) in one email.` })
      else toast({ tone: 'info', title: `${batch.batch_id} created`, description: 'The email was not delivered to anyone (local email mode).' })
      broadcastRefresh()
      onBatchCreated(batch)
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : 'The batch could not be sent.')
      tickets.reload()
    } finally {
      setSending(false)
    }
  }

  if (tickets.error && !tickets.data) return <Card><ErrorState error={tickets.error} onRetry={tickets.reload} /></Card>

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-600" data-testid="all-tickets-count">
              {tickets.data ? (
                <>
                  <strong className="text-slate-900">{tickets.data.total}</strong> imported ticket{tickets.data.total === 1 ? '' : 's'}
                  {active && <> · {rows.length} match</>}
                </>
              ) : (
                'Loading tickets…'
              )}
            </p>
            <Select aria-label="Sort tickets" className="w-44" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              <option value="priority">Sort: priority</option>
              <option value="sla">Sort: SLA time left</option>
              <option value="newest">Sort: newest</option>
              <option value="oldest">Sort: oldest</option>
            </Select>
          </div>
          <SearchInput
            placeholder="Search ticket ID, subject, category, assignee or labels"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(1)
            }}
            aria-label="Search all tickets"
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Select aria-label="Filter all tickets by priority" value={filters.priority} onChange={(e) => setFilter('priority', e.target.value)}>
              <option value="">All priorities</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {priorityMeta(p).label}
                </option>
              ))}
            </Select>
            <Select aria-label="Filter all tickets by status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
              <option value="">All statuses</option>
              {Object.entries(TICKET_STATUS_META).map(([value, meta]) => (
                <option key={value} value={value}>
                  {meta.label}
                </option>
              ))}
            </Select>
            <Select aria-label="Filter all tickets by category" value={filters.category} onChange={(e) => setFilter('category', e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </div>
          {active && (
            <Button
              variant="ghost"
              size="sm"
              icon={<FilterX className="size-3.5" />}
              onClick={() => {
                setQuery('')
                setFilters(NO_FILTERS)
                setPage(1)
              }}
            >
              Clear filters
            </Button>
          )}
        </CardBody>
      </Card>

      <Card className="overflow-hidden">
        {!tickets.data ? (
          <SkeletonRows rows={8} cols={7} />
        ) : all.length === 0 ? (
          <EmptyState icon={<TicketIcon className="size-6" />} title="No tickets imported" description="Import a CSV file to see tickets here." />
        ) : rows.length === 0 ? (
          <EmptyState icon={<FilterX className="size-6" />} title="No tickets match" description="Try a different search or clear the filters." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50/70">
                  <tr>
                    <th className={cx(TH, 'w-10')}>
                      <Checkbox aria-label="Select all selectable tickets on this page" checked={pageSelected} onChange={togglePage} disabled={!selectable.length} />
                    </th>
                    <th className={TH}>Ticket</th>
                    <th className={TH}>Priority</th>
                    <th className={TH}>Status</th>
                    <th className={TH}>Category</th>
                    <th className={TH}>Refund</th>
                    <th className={TH}>Age</th>
                    <th className={TH}>SLA</th>
                    <th className={TH}>Approval</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {visible.map((t) => {
                    const blocked = blockedReason(t)
                    return (
                      <tr key={t.ticket_id} className={cx(selection.has(t.ticket_id) ? 'bg-brand-50/50' : 'hover:bg-slate-50')}>
                        <td className={TD}>
                          <span title={blocked ?? undefined}>
                            <Checkbox aria-label={`Select ${t.ticket_id}`} checked={selection.has(t.ticket_id)} disabled={!!blocked} onChange={() => toggle(t.ticket_id)} />
                          </span>
                        </td>
                        <td className={TD}>
                          <button onClick={() => setOpenId(t.ticket_id)} className="font-mono font-medium whitespace-nowrap text-brand-700 hover:underline">
                            {t.ticket_id}
                          </button>
                          {t.subject && <p className="max-w-[16rem] truncate text-xs text-slate-500">{t.subject}</p>}
                        </td>
                        <td className={TD}>
                          <PriorityBadge priority={t.priority} />
                        </td>
                        <td className={TD}>
                          <TicketStatusBadge status={t.status} />
                        </td>
                        <td className={TD}>{t.category || '—'}</td>
                        <td className={cx(TD, 'tabular whitespace-nowrap')}>{formatMoney(t.refund_amount)}</td>
                        <td className={cx(TD, 'tabular whitespace-nowrap')}>{formatHours(ageHours(t.created_at))}</td>
                        <td className={TD}>
                          <SlaBadge state={t.sla.state} remaining={t.sla.remaining_hours} />
                        </td>
                        <td className={TD}>
                          <ApprovalBadge status={t.approval.status} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={current} pageSize={PAGE_SIZE} total={rows.length} onPage={setPage} />
          </>
        )}
      </Card>

      {selection.size > 0 && (
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-white p-3 shadow-pop">
          <p className="text-sm font-medium text-slate-900" data-testid="all-tickets-selection">
            {selection.size} ticket{selection.size === 1 ? '' : 's'} selected for manager approval
          </p>
          <div className="flex gap-2">
            <Button size="sm" icon={<Square className="size-3.5" />} onClick={() => setSelected(new Set())}>
              Clear
            </Button>
            <Button size="sm" variant="primary" icon={<Send className="size-3.5" />} onClick={() => setReviewing(true)}>
              Review & send
            </Button>
          </div>
        </div>
      )}

      {reviewing && (
        <Modal
          open
          size="lg"
          onClose={sending ? () => {} : () => setReviewing(false)}
          title="Review approval request"
          description={`${chosen.length} ticket(s) will be sent to the manager in one email, each with its own Approve, Reject and Request information links.`}
          footer={
            <>
              <Button onClick={() => setReviewing(false)} disabled={sending}>
                Back
              </Button>
              <Button variant="primary" icon={<Send className="size-4" />} onClick={send} loading={sending} disabled={!chosen.length || (email && !email.ready)}>
                {email?.delivers_real_email ? `Send ${chosen.length} to manager` : `Create batch (${email?.backend ?? 'local'} email)`}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {email && !email.ready ? (
              <InlineAlert tone="error" title="Email is not configured">Missing: {email.missing_settings.join(', ')}.</InlineAlert>
            ) : email?.delivers_real_email ? (
              <InlineAlert tone="info" icon={<Mail className="size-4" />}>The email goes to {email.manager_email} through {email.smtp_host}.</InlineAlert>
            ) : (
              <InlineAlert tone="warning" icon={<Mail className="size-4" />} title="This email will not be delivered">
                Local email mode: the message is saved for testing only.
              </InlineAlert>
            )}
            <div className="max-h-72 overflow-auto rounded-lg border border-slate-200">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="sticky top-0 bg-slate-50">
                  <tr>
                    <th className={TH}>Ticket</th>
                    <th className={TH}>Priority</th>
                    <th className={TH}>Approval reason</th>
                    <th className={TH}>Refund</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {chosen.map((t) => (
                    <tr key={t.ticket_id}>
                      <td className={cx(TD, 'font-mono font-medium whitespace-nowrap')}>{t.ticket_id}</td>
                      <td className={TD}>
                        <PriorityBadge priority={t.priority} />
                      </td>
                      <td className={TD}>
                        {t.approval.status === 'queued' ? approvalReason(t) : <Badge className="bg-indigo-50 text-indigo-700 ring-indigo-600/20">Manual request (no automatic rule)</Badge>}
                      </td>
                      <td className={cx(TD, 'tabular')}>{formatMoney(t.refund_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <Label htmlFor="all-tickets-note" hint="(optional, included in the email)">
                Note to the manager
              </Label>
              <Textarea id="all-tickets-note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            {sendError && <InlineAlert tone="error">{sendError}</InlineAlert>}
          </div>
        </Modal>
      )}

      {openId && (
        <TicketDrawer
          ticketId={openId}
          onClose={() => {
            setOpenId(null)
            tickets.reload()
          }}
        />
      )}
      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        <CheckSquare className="size-3.5" /> Any ticket can be selected. Tickets already with the manager cannot be sent again until the manager decides.
      </p>
    </div>
  )
}
