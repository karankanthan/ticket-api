import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { CheckSquare, Inbox, ListChecks, Mail, MessageSquarePlus, Send, Square, Trash2, Workflow } from 'lucide-react'
import { ApiError } from '../api/client'
import { api } from '../api/endpoints'
import type { ApprovalRequest, Batch, BatchDetail, PreviewResponse, QueueItem } from '../api/types'
import { ApprovalBadge, Badge, DeliveryBadge, PriorityBadge, SlaBadge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, CardBody, CardHeader } from '../components/ui/Card'
import { ConfirmDialog, Modal } from '../components/ui/Dialog'
import { EmptyState, ErrorState, InlineAlert, SkeletonRows } from '../components/ui/Feedback'
import { Checkbox, Input, Label, SearchInput, Select, Textarea } from '../components/ui/Form'
import { PageHeader, Segmented, Tabs } from '../components/ui/Layout'
import { AllTicketsPanel } from '../components/AllTicketsPanel'
import { useToast } from '../components/ui/toastContext'
import { broadcastRefresh, useApi } from '../hooks/useApi'
import { ageHours, cx, formatDateTime, formatHours, formatMoney } from '../lib/format'
import { DELIVERY_META, PRIORITIES, priorityMeta, reasonLabel } from '../lib/meta'
import { SCOPE_LABEL, SCOPE_PRIORITIES, exclusionReason, inScope as itemInScope, isKnownPriority, topN, type Preset, type Scope } from '../lib/selection'
import { TD, TH } from '../lib/table'

const PRESETS = [5, 10, 20]

function sameSet(a: string[], b: Set<string>) {
  return a.length === b.size && a.every((id) => b.has(id))
}

function SourceBadge({ source }: { source: QueueItem['source'] }) {
  const meta = {
    auto: ['Detected', 'bg-slate-50 text-slate-600 ring-slate-300'],
    manual: ['Manual', 'bg-indigo-50 text-indigo-700 ring-indigo-600/20'],
    resubmission: ['Resubmission', 'bg-purple-50 text-purple-700 ring-purple-600/20'],
  }[source]
  return <Badge className={meta[1]}>{meta[0]}</Badge>
}

function BatchResult({ batch, onClose }: { batch: Batch; onClose: () => void }) {
  const detail = useApi((signal) => api.batch(batch.batch_id, signal), [batch.batch_id])
  const email = batch.emails[batch.emails.length - 1]
  const failed = batch.status === 'email_failed'
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Batch ${batch.batch_id} created`}
      description={`${batch.total} approval request${batch.total === 1 ? '' : 's'} created · ${formatDateTime(batch.created_at)}`}
      footer={
        <>
          <Link to="/batches" className="inline-flex h-9 items-center rounded-lg px-3.5 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
            Open Batch History
          </Link>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className={cx('rounded-xl border p-4', failed ? 'border-red-200 bg-red-50' : batch.status === 'sent' ? 'border-emerald-200 bg-emerald-50' : 'border-sky-200 bg-sky-50')}>
          <div className="flex flex-wrap items-center gap-3">
            <Mail className="size-5 text-slate-600" />
            <span className="text-sm font-semibold text-slate-900">Email delivery:</span>
            <DeliveryBadge status={batch.status} />
          </div>
          <p className="mt-2 text-sm text-slate-700">{DELIVERY_META[batch.status]?.description}</p>
          {email?.error && <p className="mt-1 text-sm font-medium text-red-700">Error: {email.error}</p>}
          {email?.outbox_file && <p className="mt-1 font-mono text-xs break-all text-slate-600">{email.outbox_file}</p>}
          {failed && <p className="mt-2 text-sm text-slate-700">The requests were created but the manager has not been told. Fix the email settings, then use Resend in Batch History.</p>}
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Approval requests</h3>
          {detail.error ? (
            <ErrorState compact error={detail.error} onRetry={detail.reload} />
          ) : !detail.data ? (
            <SkeletonRows rows={Math.min(batch.total, 5)} cols={4} />
          ) : (
            <RequestTable requests={(detail.data as BatchDetail).requests} />
          )}
        </div>
      </div>
    </Modal>
  )
}

function RequestTable({ requests }: { requests: ApprovalRequest[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full divide-y divide-slate-100">
        <thead className="bg-slate-50">
          <tr>
            <th className={TH}>Request</th>
            <th className={TH}>Ticket</th>
            <th className={TH}>Priority</th>
            <th className={TH}>Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {requests.map((r) => (
            <tr key={r.request_id}>
              <td className={cx(TD, 'font-mono')}>{r.request_id}</td>
              <td className={cx(TD, 'font-mono')}>{r.ticket_id}</td>
              <td className={TD}>
                <PriorityBadge priority={r.ticket?.priority} />
              </td>
              <td className={TD}>
                <ApprovalBadge status={r.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ProvideInfoDialog({ request, onClose }: { request: ApprovalRequest; onClose: () => void }) {
  const toast = useToast()
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const asked = [...request.history].reverse().find((h) => h.event === 'need_more_info')
  async function save() {
    setSaving(true)
    setError('')
    try {
      await api.provideInfo(request.request_id, note)
      toast({ tone: 'success', title: `Information added to ${request.request_id}`, description: 'The ticket is back in the queue, ready to resend to the manager.' })
      broadcastRefresh()
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the information.')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal
      open
      onClose={saving ? () => {} : onClose}
      title={`Provide information for ${request.ticket_id}`}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={!note.trim()}>
            Save and requeue
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {asked?.note && (
          <div className="rounded-lg bg-purple-50 p-3 text-sm text-purple-900">
            <p className="text-xs font-semibold uppercase">Manager asked</p>
            <p className="mt-1">“{asked.note}”</p>
          </div>
        )}
        <div>
          <Label htmlFor="info-note">Your answer</Label>
          <Textarea id="info-note" rows={4} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && <InlineAlert tone="error">{error}</InlineAlert>}
      </div>
    </Modal>
  )
}

/** The manager's latest comment: the note on the most recent decision event. */
function managerComment(r: ApprovalRequest): string | null {
  const decision = [...r.history].reverse().find((h) => ['approve', 'reject', 'need_more_info'].includes(h.event))
  return decision?.note ?? null
}

function AwaitingManager({ waiting, loading }: { waiting: ApprovalRequest[] | undefined; loading: boolean }) {
  const [view, setView] = useState<'waiting' | 'all'>('waiting')
  const all = useApi((signal) => (view === 'all' ? api.approvals({}, signal) : Promise.resolve(undefined)), [view], { pollMs: 30_000 })
  const [answering, setAnswering] = useState<ApprovalRequest | null>(null)
  const requests = view === 'waiting' ? waiting : all.data?.filter((r) => r.batch_id || r.emailed_at)
  const busy = view === 'waiting' ? loading && !waiting : !all.data

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <Segmented<'waiting' | 'all'>
          label="Which requests"
          value={view}
          onChange={setView}
          options={[
            { value: 'waiting', label: 'Waiting for the manager' },
            { value: 'all', label: 'All sent' },
          ]}
        />
        <span className="text-xs text-slate-500">These tickets are not offered as new eligible candidates.</span>
      </div>
      {busy ? (
        <SkeletonRows rows={4} cols={7} />
      ) : all.error && view === 'all' ? (
        <ErrorState compact error={all.error} onRetry={all.reload} />
      ) : !requests?.length ? (
        <EmptyState icon={<Inbox className="size-6" />} title={view === 'waiting' ? 'Nothing waiting for the manager' : 'Nothing sent yet'} description="Requests appear here after you send a batch." />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50/70">
              <tr>
                <th className={TH}>Ticket</th>
                <th className={TH}>Request</th>
                <th className={TH}>Priority</th>
                <th className={TH}>Batch</th>
                <th className={TH}>Submitted</th>
                <th className={TH}>Manager decision</th>
                <th className={TH}>Manager comment</th>
                <th className={TH}>Email</th>
                <th className={TH}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {requests.map((r) => {
                const comment = managerComment(r)
                return (
                  <tr key={r.request_id}>
                    <td className={cx(TD, 'font-mono font-medium whitespace-nowrap')}>{r.ticket_id}</td>
                    <td className={cx(TD, 'font-mono whitespace-nowrap')}>{r.request_id}</td>
                    <td className={TD}>
                      <PriorityBadge priority={r.ticket?.priority} />
                    </td>
                    <td className={cx(TD, 'font-mono whitespace-nowrap')}>{r.batch_id ?? '—'}</td>
                    <td className={cx(TD, 'whitespace-nowrap')}>{formatDateTime(r.created_at)}</td>
                    <td className={TD}>
                      <ApprovalBadge status={r.status} />
                      <p className="mt-0.5 text-xs whitespace-nowrap text-slate-500">
                        {r.decided_at
                          ? formatDateTime(r.decided_at)
                          : r.status === 'info_requested'
                            ? 'Waiting for helpdesk'
                            : r.response?.overdue
                              ? <span className="font-medium text-red-700">Overdue · {formatHours(r.response.waiting_hours)}</span>
                              : r.response?.due_at
                                ? `Due ${formatDateTime(r.response.due_at)}`
                                : ''}
                      </p>
                    </td>
                    <td className={cx(TD, 'max-w-xs')}>{comment ? <span className="line-clamp-2">“{comment}”</span> : <span className="text-slate-400">—</span>}</td>
                    <td className={TD}>
                      {r.delivery ? <DeliveryBadge status={r.delivery.status} /> : <span className="text-xs text-amber-700">Not emailed</span>}
                      {r.reminders_sent ? <p className="mt-0.5 text-xs text-slate-500">{r.reminders_sent} reminder(s)</p> : null}
                    </td>
                    <td className={cx(TD, 'text-right')}>
                      {r.status === 'info_requested' && (
                        <Button size="sm" icon={<MessageSquarePlus className="size-3.5" />} onClick={() => setAnswering(r)}>
                          Provide info
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {answering && <ProvideInfoDialog request={answering} onClose={() => setAnswering(null)} />}
    </>
  )
}

export default function ControlCenterPage() {
  const toast = useToast()
  const queue = useApi((signal) => api.queue(signal), [], { pollMs: 30_000 })
  const pending = useApi((signal) => api.approvals({ status: 'pending' }, signal), [], { pollMs: 30_000 })
  const infoRequested = useApi((signal) => api.approvals({ status: 'info_requested' }, signal), [], { pollMs: 30_000 })
  const email = useApi((signal) => api.emailStatus(signal), [])

  const [params, setParams] = useSearchParams()
  const tab = (['all', 'queue', 'awaiting'].includes(params.get('tab') ?? '') ? params.get('tab') : 'queue') as 'all' | 'queue' | 'awaiting'
  const setTab = (value: 'all' | 'queue' | 'awaiting') => setParams({ tab: value }, { replace: true })
  const dashboard = useApi((signal) => api.dashboard(signal), [], { pollMs: 30_000 })
  const [scope, setScope] = useState<Scope>('all')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [preset, setPreset] = useState<Preset | null>(null)
  const [custom, setCustom] = useState('')
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [batch, setBatch] = useState<Batch | null>(null)
  const [dismissing, setDismissing] = useState<QueueItem | null>(null)
  const [dismissBusy, setDismissBusy] = useState(false)

  const items = useMemo(() => queue.data?.items ?? [], [queue.data])
  const ids = useMemo(() => new Set(items.map((i) => i.item_id)), [items])
  // Items that left the queue (sent elsewhere, withdrawn) silently drop out of the selection.
  const selection = useMemo(() => new Set([...selected].filter((id) => ids.has(id))), [selected, ids])
  const awaiting = useMemo(() => [...(infoRequested.data ?? []), ...(pending.data ?? [])], [pending.data, infoRequested.data])
  const categories = useMemo(() => [...new Set(items.map((i) => i.ticket?.category).filter(Boolean) as string[])].sort(), [items])

  const inScope = (i: QueueItem) => itemInScope(i, scope)
  const matches = (i: QueueItem) => {
    const q = search.trim().toLowerCase()
    if (category && i.ticket?.category !== category) return false
    if (!q) return true
    return [i.ticket_id, i.ticket?.category, i.ticket?.status, ...i.reasons, i.note].some((v) => (v ?? '').toLowerCase().includes(q))
  }
  const visible = items.filter((i) => inScope(i) && matches(i))
  const presetActive = preset && preset.scope === scope && sameSet(preset.ids, selection) ? preset : null

  function selectTop(count: number) {
    if (!Number.isInteger(count) || count < 1) {
      toast({ tone: 'warning', title: 'Enter a number of tickets of at least 1' })
      return
    }
    const top = topN(items, scope, count)
    setSelected(new Set(top))
    setPreset({ count, scope, ids: top })
    if (top.length < count) toast({ tone: 'info', title: `Only ${top.length} eligible tickets in ${SCOPE_LABEL[scope]}`, description: `${count} were requested.` })
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set([...current].filter((x) => ids.has(x)))
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function setMany(list: QueueItem[], on: boolean) {
    setSelected((current) => {
      const next = new Set([...current].filter((x) => ids.has(x)))
      list.forEach((i) => (on ? next.add(i.item_id) : next.delete(i.item_id)))
      return next
    })
  }

  async function openReview() {
    setPreviewing(true)
    setSendError('')
    try {
      const ordered = items.filter((i) => selection.has(i.item_id)).map((i) => i.item_id)
      setPreview(await api.preview({ mode: 'manual', item_ids: ordered }))
    } catch (err) {
      toast({ tone: 'error', title: 'Could not prepare the review', description: err instanceof ApiError ? err.message : undefined })
      queue.reload()
    } finally {
      setPreviewing(false)
    }
  }

  async function send() {
    if (!preview) return
    setSending(true)
    setSendError('')
    try {
      const result = await api.submitBatch({
        item_ids: preview.item_ids,
        note: note.trim() || null,
        selection: presetActive ? { mode: 'top', count: presetActive.count, priorities: SCOPE_PRIORITIES[presetActive.scope] ?? undefined } : { mode: 'manual' },
      })
      setBatch(result)
      setPreview(null)
      setSelected(new Set())
      setPreset(null)
      setNote('')
      if (result.status === 'sent') toast({ tone: 'success', title: `${result.batch_id} sent to the manager`, description: `${result.total} tickets in one email.` })
      else if (result.status === 'email_failed') toast({ tone: 'error', title: `${result.batch_id} created, but the email failed`, description: 'The manager has not been notified.' })
      else toast({ tone: 'info', title: `${result.batch_id} created`, description: `${DELIVERY_META[result.status].label}: the email was not delivered to anyone.` })
      broadcastRefresh()
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : 'The batch could not be sent.')
      queue.reload()
    } finally {
      setSending(false)
    }
  }

  async function confirmDismiss() {
    if (!dismissing) return
    setDismissBusy(true)
    try {
      await api.dismiss(dismissing.item_id, 'removed in Control Center')
      toast({ tone: 'success', title: `${dismissing.ticket_id} removed from the queue` })
      setDismissing(null)
      broadcastRefresh()
    } catch (err) {
      toast({ tone: 'error', title: 'Could not remove the ticket', description: err instanceof ApiError ? err.message : undefined })
    } finally {
      setDismissBusy(false)
    }
  }

  // Selection summary
  const chosen = items.filter((i) => selection.has(i.item_id))
  const byPriority = PRIORITIES.map((p) => ({ p, n: chosen.filter((i) => i.ticket?.priority === p).length }))
  const exclusions = items
    .map((i) => ({ item: i, reason: exclusionReason(i, { scope, selected: selection, matches, preset, items }) }))
    .filter((e): e is { item: QueueItem; reason: string } => e.reason !== null)
  const allVisibleSelected = visible.length > 0 && visible.every((i) => selection.has(i.item_id))

  return (
    <>
      <PageHeader
        title="Approval Control Center"
        description="Send tickets to the manager for approval: pick from the automatic eligible queue or from all tickets. Each batch is one email with separate Approve, Reject and Request information links for every ticket."
        updatedAt={queue.updatedAt}
      />

      {email.data && !email.data.ready && (
        <div className="mb-4">
          <InlineAlert tone="error" title="Email is not configured">
            Missing: {email.data.missing_settings.join(', ')}. Sending will create the requests but the email will fail.
          </InlineAlert>
        </div>
      )}
      {email.data?.ready && !email.data.delivers_real_email && (
        <div className="mb-4">
          <InlineAlert tone="info" icon={<Mail className="size-4" />} title={`Email backend: ${email.data.backend}`}>
            Batches are {email.data.backend === 'file' ? 'saved as .eml files in the local outbox' : 'printed to the backend console'}; nothing is delivered to the manager until SMTP is configured.
          </InlineAlert>
        </div>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'all', label: 'All tickets', count: dashboard.data?.tickets.total },
          { value: 'queue', label: 'Eligible queue', count: queue.data?.total },
          { value: 'awaiting', label: 'Awaiting manager', count: pending.data && infoRequested.data ? awaiting.length : undefined },
        ]}
      />

      {tab === 'all' ? (
        <div className="mt-6">
          <AllTicketsPanel email={email.data} onBatchCreated={setBatch} />
        </div>
      ) : tab === 'awaiting' ? (
        <Card className="mt-6">
          <CardHeader title="Sent to the manager" description="Every ticket already sent for approval, with the manager's decision, comment and the email delivery status." />
          {pending.error && !pending.data ? <ErrorState error={pending.error} onRetry={pending.reload} /> : <AwaitingManager waiting={pending.data && infoRequested.data ? awaiting : undefined} loading={pending.loading || infoRequested.loading} />}
        </Card>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-4">
            <Card>
              <CardBody className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-medium text-slate-700">Priorities</span>
                  <Segmented<Scope>
                    label="Priority scope"
                    value={scope}
                    onChange={setScope}
                    options={[
                      { value: 'p1', label: 'P1 only' },
                      { value: 'p1p2', label: 'P1 + P2' },
                      { value: 'all', label: 'All eligible' },
                    ]}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mr-1 text-sm font-medium text-slate-700">Quick select</span>
                  {PRESETS.map((n) => (
                    <Button key={n} size="sm" variant={presetActive?.count === n ? 'primary' : 'secondary'} onClick={() => selectTop(n)}>
                      Top {n}
                    </Button>
                  ))}
                  <form
                    className="flex items-center gap-1.5"
                    onSubmit={(e) => {
                      e.preventDefault()
                      selectTop(Number(custom))
                    }}
                  >
                    <Input aria-label="Custom number of tickets" type="number" min={1} max={100} placeholder="Custom" value={custom} onChange={(e) => setCustom(e.target.value)} className="h-8 w-24" />
                    <Button size="sm" type="submit" variant={presetActive && !PRESETS.includes(presetActive.count) ? 'primary' : 'secondary'}>
                      Select top
                    </Button>
                  </form>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <SearchInput className="flex-1" placeholder="Search ticket, category or reason" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search queue" />
                  <Select aria-label="Filter by category" className="sm:w-48" value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="">All categories</option>
                    {categories.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                  <Button size="md" icon={allVisibleSelected ? <Square className="size-4" /> : <CheckSquare className="size-4" />} onClick={() => setMany(visible, !allVisibleSelected)} disabled={!visible.length}>
                    {allVisibleSelected ? 'Deselect shown' : 'Select all shown'}
                  </Button>
                </div>
              </CardBody>
            </Card>

            {queue.error && !queue.data ? (
              <Card>
                <ErrorState error={queue.error} onRetry={queue.reload} />
              </Card>
            ) : !queue.data ? (
              <Card>
                <SkeletonRows rows={8} cols={6} />
              </Card>
            ) : items.length === 0 ? (
              <Card>
                <EmptyState
                  icon={<ListChecks className="size-6" />}
                  title="No tickets need approval right now"
                  description="Tickets are added automatically after a CSV import, or manually from All Tickets."
                  action={
                    <Link to="/tickets" className="text-sm font-medium text-brand-600">
                      Go to All Tickets
                    </Link>
                  }
                />
              </Card>
            ) : visible.length === 0 ? (
              <Card>
                <EmptyState title="No tickets match" description={`Nothing in ${SCOPE_LABEL[scope]} matches the current search or category.`} />
              </Card>
            ) : (
              [...PRIORITIES.filter((p) => SCOPE_PRIORITIES[scope]?.includes(p) ?? true), ...(scope === 'all' ? ['other'] : [])].map((p) => {
                const group = visible.filter((i) => (p === 'other' ? !isKnownPriority(i.ticket?.priority) : i.ticket?.priority === p))
                if (!group.length) return null
                const groupSelected = group.every((i) => selection.has(i.item_id))
                return (
                  <Card key={p} className="overflow-hidden">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <Checkbox aria-label={`Select all ${p === 'other' ? 'other priorities' : priorityMeta(p).label}`} checked={groupSelected} onChange={() => setMany(group, !groupSelected)} />
                        {p === 'other' ? <Badge className="bg-slate-100 text-slate-600 ring-slate-500/20">Other priority</Badge> : <PriorityBadge priority={p} />}
                        <span className="text-sm text-slate-500">
                          {group.length} ticket{group.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <span className="text-xs text-slate-500">{group.filter((i) => selection.has(i.item_id)).length} selected</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-slate-100">
                        <thead>
                          <tr>
                            <th className={cx(TH, 'w-10')}>
                              <span className="sr-only">Select</span>
                            </th>
                            <th className={TH}>Rank</th>
                            <th className={TH}>Ticket</th>
                            <th className={TH}>Approval reason</th>
                            <th className={TH}>Refund</th>
                            <th className={TH}>Age</th>
                            <th className={TH}>SLA</th>
                            <th className={TH}>Source</th>
                            <th className={TH}>
                              <span className="sr-only">Actions</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {group.map((i) => (
                            <tr key={i.item_id} className={cx(selection.has(i.item_id) ? 'bg-brand-50/50' : 'hover:bg-slate-50')}>
                              <td className={TD}>
                                <Checkbox aria-label={`Select ${i.ticket_id}`} checked={selection.has(i.item_id)} onChange={() => toggle(i.item_id)} />
                              </td>
                              <td className={cx(TD, 'tabular text-slate-400')}>#{i.rank}</td>
                              <td className={TD}>
                                <Link to={`/tickets?ticket=${encodeURIComponent(i.ticket_id)}`} className="font-mono font-medium whitespace-nowrap text-brand-700 hover:underline">
                                  {i.ticket_id}
                                </Link>
                                <p className="text-xs text-slate-500">{i.ticket?.category || 'Uncategorised'}</p>
                              </td>
                              <td className={TD}>
                                <div className="flex flex-wrap gap-1">
                                  {i.reasons.length ? (
                                    i.reasons.map((r) => (
                                      <Badge key={r} className="bg-white text-slate-700 ring-slate-300">
                                        {reasonLabel(r)}
                                      </Badge>
                                    ))
                                  ) : (
                                    <span className="text-xs text-slate-500">{i.note ? `Manual: ${i.note}` : 'Manual request'}</span>
                                  )}
                                </div>
                              </td>
                              <td className={cx(TD, 'tabular whitespace-nowrap')}>{formatMoney(i.refund_amount)}</td>
                              <td className={cx(TD, 'tabular whitespace-nowrap')}>{formatHours(i.sla?.elapsed_hours ?? ageHours(i.ticket?.created_at))}</td>
                              <td className={TD}>{i.sla && <SlaBadge state={i.sla.state} remaining={i.sla.remaining_hours} />}</td>
                              <td className={TD}>
                                <SourceBadge source={i.source} />
                              </td>
                              <td className={cx(TD, 'text-right')}>
                                <button onClick={() => setDismissing(i)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Remove ${i.ticket_id} from queue`} title="Remove from queue">
                                  <Trash2 className="size-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                )
              })
            )}
          </div>

          <aside className="xl:sticky xl:top-24 xl:self-start">
            <Card>
              <CardHeader icon={<Workflow className="size-4" />} title="Selection" />
              <CardBody className="space-y-5">
                <p className="text-lg font-semibold text-slate-900" data-testid="selection-summary">
                  {selection.size} of {items.length} eligible ticket{items.length === 1 ? '' : 's'} selected
                </p>
                {presetActive && (
                  <p className="-mt-3 text-xs text-slate-500">
                    Top {presetActive.count} · {SCOPE_LABEL[presetActive.scope]}
                  </p>
                )}
                <div className="space-y-2">
                  <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Priority breakdown</p>
                  {byPriority.map(({ p, n }) => (
                    <div key={p} className="flex items-center gap-2 text-sm">
                      <span className="w-20 text-slate-600">{priorityMeta(p).label}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full" style={{ width: `${selection.size ? (n / selection.size) * 100 : 0}%`, background: priorityMeta(p).chart }} />
                      </div>
                      <span className="tabular w-6 text-right font-medium">{n}</span>
                    </div>
                  ))}
                </div>
                <div className="space-y-2 text-sm">
                  <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    Eligible but not included ({exclusions.length})
                  </p>
                  {exclusions.length === 0 ? (
                    <p className="text-slate-500">Every eligible ticket is selected.</p>
                  ) : (
                    <ul className="max-h-56 space-y-1 overflow-y-auto pr-1" data-testid="exclusions">
                      {exclusions.map(({ item, reason }) => (
                        <li key={item.item_id} className="flex justify-between gap-3">
                          <span className="font-mono text-slate-800">{item.ticket_id}</span>
                          <span className="text-right text-xs text-slate-500">{reason}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="border-t border-slate-100 pt-2 text-xs text-slate-500" data-testid="awaiting-note">
                    Not counted as eligible: {pending.data && infoRequested.data ? awaiting.length : '…'} ticket(s) already with the manager.
                  </p>
                </div>
                <div className="flex gap-2 border-t border-slate-100 pt-4">
                  <Button className="flex-1" onClick={() => setSelected(new Set())} disabled={!selection.size}>
                    Clear
                  </Button>
                  <Button className="flex-[2]" variant="primary" icon={<Send className="size-4" />} onClick={openReview} loading={previewing} disabled={!selection.size}>
                    Review & send
                  </Button>
                </div>
              </CardBody>
            </Card>
          </aside>
        </div>
      )}

      {preview && (
        <Modal
          open
          size="xl"
          onClose={sending ? () => {} : () => setPreview(null)}
          title="Review batch before sending"
          description={`${preview.selected_count} of ${items.length} eligible tickets selected. The manager receives one email with individual links for each ticket.`}
          footer={
            <>
              <Button onClick={() => setPreview(null)} disabled={sending}>
                Back to selection
              </Button>
              <Button variant="primary" icon={<Send className="size-4" />} onClick={send} loading={sending} disabled={!preview.email.ready}>
                {preview.email.delivers_real_email ? `Send ${preview.selected_count} to manager` : `Create batch (${preview.email.backend} email)`}
              </Button>
            </>
          }
        >
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              {PRIORITIES.map((p) => {
                const n = preview.items.filter((i) => i.ticket?.priority === p).length
                return n ? (
                  <Badge key={p} className={priorityMeta(p).badge}>
                    {priorityMeta(p).label}: {n}
                  </Badge>
                ) : null
              })}
            </div>
            {exclusions.length > 0 && (
              <details className="rounded-lg border border-slate-200 px-4 py-2 text-sm">
                <summary className="cursor-pointer text-slate-700">{exclusions.length} eligible ticket(s) will not be emailed</summary>
                <ul className="mt-2 space-y-1">
                  {exclusions.map(({ item, reason }) => (
                    <li key={item.item_id} className="flex justify-between gap-3">
                      <span className="font-mono">{item.ticket_id}</span>
                      <span className="text-xs text-slate-500">{reason}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {preview.warnings.map((w) => (
              <InlineAlert key={w} tone="warning">
                {w}
              </InlineAlert>
            ))}
            {!preview.email.ready ? (
              <InlineAlert tone="error" title="Email is not configured">
                Missing: {preview.email.missing_settings.join(', ')}. Fix this in the backend .env before sending.
              </InlineAlert>
            ) : preview.email.delivers_real_email ? (
              <InlineAlert tone="info" icon={<Mail className="size-4" />}>
                The email goes to {preview.email.manager_email} through {preview.email.smtp_host}.
              </InlineAlert>
            ) : (
              <InlineAlert tone="warning" icon={<Mail className="size-4" />} title="This email will not be delivered">
                The email backend is “{preview.email.backend}”: the message is {preview.email.backend === 'file' ? 'saved to the local outbox' : 'printed in the backend console'} for testing.
              </InlineAlert>
            )}
            <div className="max-h-80 overflow-auto rounded-lg border border-slate-200">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="sticky top-0 bg-slate-50">
                  <tr>
                    <th className={TH}>Rank</th>
                    <th className={TH}>Ticket</th>
                    <th className={TH}>Priority</th>
                    <th className={TH}>Reason</th>
                    <th className={TH}>Refund</th>
                    <th className={TH}>SLA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.items.map((i) => (
                    <tr key={i.item_id}>
                      <td className={cx(TD, 'tabular text-slate-400')}>#{i.rank}</td>
                      <td className={cx(TD, 'font-mono font-medium')}>{i.ticket_id}</td>
                      <td className={TD}>
                        <PriorityBadge priority={i.ticket?.priority} />
                      </td>
                      <td className={TD}>{i.reasons.map(reasonLabel).join(', ') || 'Manual request'}</td>
                      <td className={cx(TD, 'tabular')}>{formatMoney(i.refund_amount)}</td>
                      <td className={TD}>{i.sla && <SlaBadge state={i.sla.state} remaining={i.sla.remaining_hours} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <Label htmlFor="batch-note" hint="(optional, included in the email)">
                Note to the manager
              </Label>
              <Textarea id="batch-note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Please review the urgent refunds today." />
            </div>
            {sendError && <InlineAlert tone="error">{sendError}</InlineAlert>}
          </div>
        </Modal>
      )}

      {batch && <BatchResult batch={batch} onClose={() => setBatch(null)} />}

      <ConfirmDialog
        open={!!dismissing}
        tone="danger"
        title={`Remove ${dismissing?.ticket_id} from the queue?`}
        confirmLabel="Remove"
        loading={dismissBusy}
        onCancel={() => setDismissing(null)}
        onConfirm={confirmDismiss}
      >
        <p className="text-sm text-slate-600">The ticket will not be recommended again automatically. You can still request approval for it manually from All Tickets.</p>
      </ConfirmDialog>
    </>
  )
}
