import { useState } from 'react'
import { Layers, Mail, RotateCw } from 'lucide-react'
import { ApiError } from '../api/client'
import { api } from '../api/endpoints'
import type { Batch } from '../api/types'
import { ApprovalBadge, Badge, DeliveryBadge, PriorityBadge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { ConfirmDialog, Drawer } from '../components/ui/Dialog'
import { EmptyState, ErrorState, InlineAlert, SkeletonRows } from '../components/ui/Feedback'
import { DefinitionList, PageHeader } from '../components/ui/Layout'
import { useToast } from '../components/ui/toastContext'
import { broadcastRefresh, useApi } from '../hooks/useApi'
import { cx, formatDateTime, titleCase } from '../lib/format'
import { DELIVERY_META, PRIORITIES, priorityMeta } from '../lib/meta'
import { TD, TH } from '../lib/table'

function Progress({ batch }: { batch: Batch }) {
  const done = batch.counts.approved + batch.counts.rejected
  const pct = batch.total ? (done / batch.total) * 100 : 0
  return (
    <div className="min-w-36">
      <div className="flex justify-between text-xs text-slate-500">
        <span>
          {done}/{batch.total} decided
        </span>
        <span>{batch.counts.pending + batch.counts.info_requested} open</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function PriorityChips({ priorities }: { priorities: Record<string, number> }) {
  return (
    <div className="flex flex-wrap gap-1">
      {PRIORITIES.filter((p) => priorities[p]).map((p) => (
        <Badge key={p} className={priorityMeta(p).badge}>
          {priorityMeta(p).short} × {priorities[p]}
        </Badge>
      ))}
    </div>
  )
}

function BatchDrawer({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  const toast = useToast()
  const detail = useApi((signal) => api.batch(batchId, signal), [batchId])
  const [confirm, setConfirm] = useState(false)
  const [resending, setResending] = useState(false)
  const b = detail.data
  const openCount = b ? b.requests.filter((r) => r.status === 'pending' && r.batch_id === b.batch_id).length : 0

  async function resend() {
    setResending(true)
    try {
      const result = await api.resendBatch(batchId)
      const last = result.emails[result.emails.length - 1]
      if (last?.status === 'failed') toast({ tone: 'error', title: 'Resend failed', description: last.error ?? undefined })
      else toast({ tone: last?.status === 'sent' ? 'success' : 'info', title: `Fresh links: ${DELIVERY_META[last.status].label}`, description: DELIVERY_META[last.status].description })
      detail.reload()
      broadcastRefresh()
    } catch (err) {
      toast({ tone: 'error', title: 'Could not resend', description: err instanceof ApiError ? err.message : undefined })
    } finally {
      setResending(false)
      setConfirm(false)
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={<span className="font-mono">{batchId}</span>}
      subtitle={b && <DeliveryBadge status={b.status} />}
      footer={
        b &&
        openCount > 0 && (
          <Button icon={<RotateCw className="size-4" />} onClick={() => setConfirm(true)}>
            Resend fresh links ({openCount})
          </Button>
        )
      }
    >
      {detail.error && !b ? (
        <ErrorState error={detail.error} onRetry={detail.reload} />
      ) : !b ? (
        <SkeletonRows rows={5} cols={3} />
      ) : (
        <div className="space-y-6">
          <DefinitionList
            items={[
              { label: 'Submitted', value: formatDateTime(b.created_at) },
              { label: 'Tickets', value: b.total },
              { label: 'Selection', value: b.selection?.mode === 'top' ? `Top ${b.selection.count} (${b.selection.priorities?.length ? b.selection.priorities.map((p) => priorityMeta(p).short).join(', ') : 'all eligible priorities'})` : 'Manual selection' },
              { label: 'Priorities', value: <PriorityChips priorities={b.priorities} /> },
            ]}
          />
          {b.note && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">Note to manager: “{b.note}”</p>}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Individual decisions</h3>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={TH}>Ticket</th>
                    <th className={TH}>Priority</th>
                    <th className={TH}>Decision</th>
                    <th className={TH}>When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {b.requests.map((r) => (
                    <tr key={r.request_id}>
                      <td className={TD}>
                        <span className="font-mono font-medium">{r.ticket_id}</span>
                        <p className="font-mono text-xs text-slate-400">{r.request_id}</p>
                      </td>
                      <td className={TD}>
                        <PriorityBadge priority={r.ticket?.priority} />
                      </td>
                      <td className={TD}>
                        <ApprovalBadge status={r.status} />
                        {r.note && <p className="mt-1 max-w-[12rem] truncate text-xs text-slate-500" title={r.note}>“{r.note}”</p>}
                      </td>
                      <td className={cx(TD, 'text-xs whitespace-nowrap')}>{formatDateTime(r.decided_at, '—')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Email attempts</h3>
            <ul className="space-y-2">
              {b.emails.map((e, i) => (
                <li key={i} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                      <Mail className="size-4 text-slate-400" /> {titleCase(e.kind)}
                    </span>
                    <DeliveryBadge status={e.status} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatDateTime(e.at)} · {e.request_ids.length} ticket(s) · {e.backend}
                    {e.recipient ? ` · to ${e.recipient}` : ''}
                    {e.attempts > 1 ? ` · ${e.attempts} attempts` : ''}
                  </p>
                  {e.links_expire_at && e.status !== 'failed' && <p className="text-xs text-slate-500">Links expire {formatDateTime(e.links_expire_at)}</p>}
                  {e.error && <p className="mt-1 text-xs font-medium text-red-700">{e.error}</p>}
                  {e.outbox_file && <p className="mt-1 font-mono text-[11px] break-all text-slate-400">{e.outbox_file}</p>}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
      <ConfirmDialog open={confirm} title="Resend fresh links?" confirmLabel="Resend" loading={resending} onCancel={() => setConfirm(false)} onConfirm={resend}>
        <p className="text-sm text-slate-600">The manager gets a new email for the {openCount} pending request(s). Links in earlier emails for these tickets stop working once the new email is sent.</p>
      </ConfirmDialog>
    </Drawer>
  )
}

export default function BatchesPage() {
  const batches = useApi((signal) => api.batches(signal), [], { pollMs: 30_000 })
  const [open, setOpen] = useState<string | null>(null)
  const failed = batches.data?.filter((b) => b.status === 'email_failed').length ?? 0

  return (
    <>
      <PageHeader title="Batch History" description="Every batch sent from the Control Center, its email delivery status and the manager's decision on each ticket." updatedAt={batches.updatedAt} />
      {failed > 0 && (
        <div className="mb-4">
          <InlineAlert tone="error" title={`${failed} batch${failed === 1 ? '' : 'es'} could not be emailed`}>
            Open the batch and use Resend after fixing the email settings.
          </InlineAlert>
        </div>
      )}
      <Card>
        {batches.error && !batches.data ? (
          <ErrorState error={batches.error} onRetry={batches.reload} />
        ) : !batches.data ? (
          <SkeletonRows rows={5} cols={6} />
        ) : batches.data.length === 0 ? (
          <EmptyState icon={<Layers className="size-6" />} title="No batches yet" description="Batches appear here after you send tickets from the Approval Control Center." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50/70">
                <tr>
                  <th className={TH}>Batch</th>
                  <th className={TH}>Submitted</th>
                  <th className={TH}>Tickets</th>
                  <th className={TH}>Priorities</th>
                  <th className={TH}>Email delivery</th>
                  <th className={TH}>Progress</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {batches.data.map((b) => (
                  <tr key={b.batch_id} onClick={() => setOpen(b.batch_id)} className="cursor-pointer hover:bg-slate-50">
                    <td className={TD}>
                      <button className="font-mono font-medium text-brand-700 hover:underline" onClick={() => setOpen(b.batch_id)}>
                        {b.batch_id}
                      </button>
                    </td>
                    <td className={cx(TD, 'whitespace-nowrap')}>{formatDateTime(b.created_at)}</td>
                    <td className={cx(TD, 'tabular')}>{b.total}</td>
                    <td className={TD}>
                      <PriorityChips priorities={b.priorities} />
                    </td>
                    <td className={TD}>
                      <DeliveryBadge status={b.status} />
                    </td>
                    <td className={TD}>
                      <Progress batch={b} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {open && <BatchDrawer batchId={open} onClose={() => setOpen(null)} />}
    </>
  )
}
