import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ClipboardCheck, MessageSquare } from 'lucide-react'
import { api } from '../api/endpoints'
import type { ApprovalRequest, RequestStatus } from '../api/types'
import { ApprovalBadge, Badge, DeliveryBadge, PriorityBadge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import { Drawer } from '../components/ui/Dialog'
import { EmptyState, ErrorState, SkeletonRows } from '../components/ui/Feedback'
import { SearchInput } from '../components/ui/Form'
import { DefinitionList, PageHeader, Pagination, Tabs } from '../components/ui/Layout'
import { useApi } from '../hooks/useApi'
import { cx, formatDateTime, formatHours, formatMoney, titleCase } from '../lib/format'
import { reasonLabel } from '../lib/meta'
import { TD, TH } from '../lib/table'

type Filter = 'all' | RequestStatus
const PAGE_SIZE = 20

/** The manager's latest comment: the note on the most recent decision event. */
function managerComment(r: ApprovalRequest): string | null {
  const decision = [...r.history].reverse().find((h) => ['approve', 'reject', 'need_more_info'].includes(h.event))
  return decision?.note ?? null
}

function decidedVia(r: ApprovalRequest): string | null {
  const decision = [...r.history].reverse().find((h) => ['approve', 'reject', 'need_more_info'].includes(h.event))
  return decision ? decision.via : null
}

function RequestDrawer({ request, onClose }: { request: ApprovalRequest; onClose: () => void }) {
  return (
    <Drawer open onClose={onClose} title={<span className="font-mono">{request.request_id}</span>} subtitle={<ApprovalBadge status={request.status} />}>
      <div className="space-y-6">
        <DefinitionList
          items={[
            { label: 'Ticket', value: <Link className="font-mono text-brand-700 hover:underline" to={`/tickets?ticket=${encodeURIComponent(request.ticket_id)}`}>{request.ticket_id}</Link> },
            { label: 'Priority', value: <PriorityBadge priority={request.ticket?.priority} /> },
            { label: 'Category', value: request.ticket?.category || '—' },
            { label: 'Batch', value: request.batch_id ? <span className="font-mono">{request.batch_id}</span> : 'Not batched (created through the API)' },
            { label: 'Refund amount', value: formatMoney(request.refund_amount, 'Not provided') },
            { label: 'Team account closing', value: request.team_account_closing ? 'Yes' : 'No' },
            { label: 'Created', value: formatDateTime(request.created_at) },
            { label: 'Emailed to manager', value: formatDateTime(request.emailed_at, 'Not emailed') },
            { label: 'Decision time', value: formatDateTime(request.decided_at, 'Not decided') },
            { label: 'Reminders sent', value: request.reminders_sent ?? 0 },
            {
              label: 'Manager response target',
              value: request.response ? `${formatHours(request.response.target_hours)}${request.response.overdue ? ' · overdue' : ''}` : '—',
            },
          ]}
        />
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Why approval is needed</h3>
          <div className="flex flex-wrap gap-1">
            {request.escalation_reasons.length ? (
              request.escalation_reasons.map((r) => (
                <Badge key={r} className="bg-white text-slate-700 ring-slate-300">
                  {reasonLabel(r)}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-slate-500">Manual request</span>
            )}
          </div>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Employee notification</h3>
          {request.employee_notifications?.length ? (
            <ul className="space-y-2" data-testid="employee-notifications">
              {request.employee_notifications.map((n, i) => (
                <li key={i} className="rounded-lg border border-slate-200 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    {n.status === 'skipped' ? <Badge className="bg-slate-100 text-slate-600 ring-slate-500/20">Not sent</Badge> : <DeliveryBadge status={n.status} />}
                    <span className="text-slate-600">{titleCase(n.decision)} notice{n.recipient ? ` to ${n.recipient}` : ''}</span>
                    <span className="text-xs text-slate-400">{formatDateTime(n.at)}</span>
                  </div>
                  {n.reason && <p className="mt-1 text-xs text-slate-500">Skipped: {n.reason}</p>}
                  {n.error && <p className="mt-1 text-xs font-medium text-red-700">{n.error}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">
              {request.status === 'pending' ? 'Sent after the manager decides' : 'No notification recorded'}
              {request.employee_email ? ` (employee: ${request.employee_email}).` : ' (no employee email on this ticket).'}
            </p>
          )}
        </div>
        <div>
          <h3 className="mb-3 text-sm font-semibold text-slate-900">History</h3>
          <ol className="relative space-y-4 border-l border-slate-200 pl-5">
            {request.history.map((h, i) => (
              <li key={i}>
                <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border-2 border-white bg-brand-500" />
                <p className="text-sm font-medium text-slate-900">
                  {titleCase(h.event)} <span className="font-normal text-slate-500">via {h.via}</span>
                </p>
                <p className="text-xs text-slate-500">{formatDateTime(h.at)}</p>
                {h.note && <p className="mt-1 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">“{h.note}”</p>}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Drawer>
  )
}

export default function ApprovalsPage() {
  const approvals = useApi((signal) => api.approvals({}, signal), [], { pollMs: 30_000 })
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<ApprovalRequest | null>(null)

  const all = useMemo(() => approvals.data ?? [], [approvals.data])
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: all.length, pending: 0, approved: 0, rejected: 0, info_requested: 0 }
    all.forEach((r) => c[r.status]++)
    return c
  }, [all])
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all.filter(
      (r) =>
        (filter === 'all' || r.status === filter) &&
        (!q || [r.request_id, r.ticket_id, r.batch_id, managerComment(r)].some((v) => (v ?? '').toLowerCase().includes(q))),
    )
  }, [all, filter, query])
  const current = Math.min(page, Math.max(1, Math.ceil(rows.length / PAGE_SIZE)))

  return (
    <>
      <PageHeader title="Approval History" description="Every approval request and the manager's decisions. Updates automatically after a manager acts on an email link." updatedAt={approvals.updatedAt} />
      <Tabs
        value={filter}
        onChange={(v) => {
          setFilter(v)
          setPage(1)
        }}
        tabs={[
          { value: 'all', label: 'All', count: counts.all },
          { value: 'pending', label: 'Pending', count: counts.pending },
          { value: 'approved', label: 'Approved', count: counts.approved },
          { value: 'rejected', label: 'Rejected', count: counts.rejected },
          { value: 'info_requested', label: 'More information requested', count: counts.info_requested },
        ]}
      />
      <Card className="mt-6">
        <div className="border-b border-slate-100 p-4">
          <SearchInput
            placeholder="Search request, ticket, batch or comment"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(1)
            }}
            aria-label="Search approvals"
          />
        </div>
        {approvals.error && !approvals.data ? (
          <ErrorState error={approvals.error} onRetry={approvals.reload} />
        ) : !approvals.data ? (
          <SkeletonRows rows={6} cols={7} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<ClipboardCheck className="size-6" />} title={all.length ? 'No requests match' : 'No approval requests yet'} description={all.length ? 'Try another tab or search.' : 'Requests are created when you send a batch from the Control Center.'} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50/70">
                  <tr>
                    <th className={TH}>Request</th>
                    <th className={TH}>Ticket</th>
                    <th className={TH}>Priority</th>
                    <th className={TH}>Status</th>
                    <th className={TH}>Manager comment</th>
                    <th className={TH}>Decision time</th>
                    <th className={TH}>Batch</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE).map((r) => {
                    const comment = managerComment(r)
                    return (
                      <tr key={r.request_id} onClick={() => setOpen(r)} className="cursor-pointer hover:bg-slate-50">
                        <td className={TD}>
                          <button className="font-mono font-medium text-brand-700 hover:underline" onClick={() => setOpen(r)}>
                            {r.request_id}
                          </button>
                        </td>
                        <td className={cx(TD, 'font-mono whitespace-nowrap')}>{r.ticket_id}</td>
                        <td className={TD}>
                          <PriorityBadge priority={r.ticket?.priority} />
                        </td>
                        <td className={TD}>
                          <ApprovalBadge status={r.status} />
                          {decidedVia(r) && <p className="mt-0.5 text-xs text-slate-400">via {decidedVia(r)}</p>}
                        </td>
                        <td className={cx(TD, 'max-w-xs')}>
                          {comment ? (
                            <span className="flex items-start gap-1.5 text-slate-700">
                              <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-slate-400" />
                              <span className="line-clamp-2">{comment}</span>
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className={cx(TD, 'whitespace-nowrap')}>{formatDateTime(r.decided_at)}</td>
                        <td className={cx(TD, 'font-mono')}>{r.batch_id ?? '—'}</td>
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
      {open && <RequestDrawer request={open} onClose={() => setOpen(null)} />}
    </>
  )
}
