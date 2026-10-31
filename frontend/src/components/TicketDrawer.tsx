import { useState } from 'react'
import { ClipboardCheck } from 'lucide-react'
import { api } from '../api/endpoints'
import { useApi } from '../hooks/useApi'
import { formatDateTime, formatHours, formatMoney, timeAgo, titleCase } from '../lib/format'
import { reasonLabel } from '../lib/meta'
import { RequestApprovalDialog } from './RequestApprovalDialog'
import { ApprovalBadge, Badge, PriorityBadge, SlaBadge, TicketStatusBadge } from './ui/Badge'
import { Button } from './ui/Button'
import { Drawer } from './ui/Dialog'
import { ErrorState, Skeleton } from './ui/Feedback'
import { DefinitionList } from './ui/Layout'

const BLOCKING = new Set(['queued', 'pending', 'info_requested'])

export function TicketDrawer({ ticketId, onClose }: { ticketId: string; onClose: () => void }) {
  const detail = useApi((signal) => api.ticket(ticketId, signal), [ticketId])
  const [requesting, setRequesting] = useState(false)
  const t = detail.data
  const blocked = t ? BLOCKING.has(t.approval.status) : true

  return (
    <Drawer
      open
      onClose={onClose}
      title={<span className="font-mono">{ticketId}</span>}
      subtitle={t ? t.subject || t.category || 'Ticket details' : 'Loading…'}
      footer={
        t && (
          <Button
            variant="primary"
            icon={<ClipboardCheck className="size-4" />}
            disabled={blocked}
            title={blocked ? 'This ticket is already in the queue or waiting for the manager.' : undefined}
            onClick={() => setRequesting(true)}
          >
            Request approval
          </Button>
        )
      }
    >
      {detail.error && !t ? (
        <ErrorState error={detail.error} onRetry={detail.reload} />
      ) : !t ? (
        <div className="space-y-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-2">
            <PriorityBadge priority={t.priority} />
            <TicketStatusBadge status={t.status} />
            <ApprovalBadge status={t.approval.status} />
          </div>
          {t.description && <p className="rounded-lg bg-slate-50 p-3 text-sm whitespace-pre-wrap text-slate-700">{t.description}</p>}
          <DefinitionList
            items={[
              { label: 'Category', value: t.category || '—' },
              { label: 'Assignee', value: t.assigned_to || '—' },
              { label: 'Raised by (employee)', value: t.employee_email || 'No employee email — no decision notice' },
              { label: 'Created', value: formatDateTime(t.created_at) },
              { label: 'Resolved', value: formatDateTime(t.resolved_at, 'Not resolved / not available') },
              { label: 'Refund amount', value: formatMoney(t.refund_amount, 'Not provided') },
              { label: 'Team account closing', value: t.team_account_closing ? 'Yes (explicit)' : 'No' },
              { label: 'Labels', value: t.labels || '—' },
            ]}
          />

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">SLA</h3>
            <div className="rounded-lg border border-slate-200 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <SlaBadge state={t.sla.state} remaining={t.sla.remaining_hours} />
                {t.sla.target_hours !== null && <span className="text-sm text-slate-600">Target {formatHours(t.sla.target_hours)}</span>}
                {t.sla.due_at && <span className="text-sm text-slate-600">Due {formatDateTime(t.sla.due_at)}</span>}
              </div>
              {t.sla.reason && <p className="mt-2 text-xs text-slate-500">Not calculated: {t.sla.reason}.</p>}
              {t.sla.elapsed_hours !== null && <p className="mt-2 text-xs text-slate-500">Elapsed {formatHours(t.sla.elapsed_hours)}</p>}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Approval</h3>
            {t.approval.status === 'queued' && (
              <p className="mb-3 text-sm text-slate-600">
                In the approval queue: {t.approval.queue_reasons.map(reasonLabel).join(', ') || 'manual request'}.
              </p>
            )}
            {t.requests.length === 0 ? (
              <p className="text-sm text-slate-500">No approval requests for this ticket.</p>
            ) : (
              <ul className="space-y-3">
                {t.requests.map((r) => (
                  <li key={r.request_id} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-sm font-medium">{r.request_id}</span>
                      <ApprovalBadge status={r.status} />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {r.batch_id ? `Batch ${r.batch_id} · ` : ''}created {timeAgo(r.created_at)}
                      {r.decided_at ? ` · decided ${formatDateTime(r.decided_at)}` : ''}
                    </p>
                    {r.escalation_reasons.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {r.escalation_reasons.map((reason) => (
                          <Badge key={reason} className="bg-slate-50 text-slate-600 ring-slate-300">
                            {reasonLabel(reason)}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <ol className="mt-3 space-y-1.5 border-l border-slate-200 pl-4">
                      {r.history.map((h, i) => (
                        <li key={i} className="text-xs text-slate-600">
                          <span className="font-medium text-slate-800">{titleCase(h.event)}</span> via {h.via} · {formatDateTime(h.at)}
                          {h.note && <span className="block text-slate-500">“{h.note}”</span>}
                        </li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      {t && requesting && <RequestApprovalDialog ticket={t} open onClose={() => setRequesting(false)} onDone={detail.reload} />}
    </Drawer>
  )
}
