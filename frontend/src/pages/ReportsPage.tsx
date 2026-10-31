import { useMemo } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../api/endpoints'
import type { ApprovalRequest, Batch, Dashboard, Ticket } from '../api/types'
import { BarsChart, DonutChart } from '../components/charts'
import { Card, CardBody, CardHeader } from '../components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '../components/ui/Feedback'
import { PageHeader } from '../components/ui/Layout'
import { useApi } from '../hooks/useApi'
import { formatHours, parseDate, percent } from '../lib/format'
import { APPROVAL_META, DELIVERY_META, PRIORITIES, SLA_META, TICKET_STATUS_META, priorityMeta } from '../lib/meta'

const DECISIONS = new Set(['approve', 'reject', 'need_more_info'])

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function volume(tickets: Ticket[]) {
  const counts = new Map<string, number>()
  tickets.forEach((t) => {
    const d = parseDate(t.created_at)
    if (d) counts.set(dayKey(d), (counts.get(dayKey(d)) ?? 0) + 1)
  })
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ day, count }))
}

/** Hours from the first email to the manager's first response, for requests that have both. */
function responseTimes(requests: ApprovalRequest[]) {
  return requests
    .map((r) => {
      const sent = parseDate(r.emailed_at)
      const first = r.history.find((h) => DECISIONS.has(h.event))
      const answered = parseDate(first?.at)
      if (!sent || !answered || answered < sent) return null
      return { hours: (answered.getTime() - sent.getTime()) / 3_600_000, target: r.response?.target_hours ?? null }
    })
    .filter((x): x is { hours: number; target: number | null } => x !== null)
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="tabular mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

function Reports({ tickets, approvals, batches, dashboard }: { tickets: Ticket[]; approvals: ApprovalRequest[]; batches: Batch[]; dashboard: Dashboard }) {
  const daily = useMemo(() => volume(tickets), [tickets])
  const times = useMemo(() => responseTimes(approvals), [approvals])
  const sorted = [...times].map((t) => t.hours).sort((a, b) => a - b)
  const median = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : null
  const average = sorted.length ? sorted.reduce((s, h) => s + h, 0) / sorted.length : null
  const withinTarget = times.filter((t) => t.target !== null && t.hours <= t.target).length
  const buckets = [
    { name: 'Under 1 h', test: (h: number) => h < 1 },
    { name: '1–4 h', test: (h: number) => h >= 1 && h < 4 },
    { name: '4–24 h', test: (h: number) => h >= 4 && h < 24 },
    { name: 'Over 24 h', test: (h: number) => h >= 24 },
  ].map((b, i) => ({ name: b.name, value: sorted.filter(b.test).length, color: ['#10b981', '#3b6af5', '#f59e0b', '#e11d48'][i] }))

  const closed = dashboard.ticket_sla.closed
  const measured = closed.met + closed.missed
  const decided = dashboard.approvals.by_status.approved + dashboard.approvals.by_status.rejected
  const statuses = Object.keys(TICKET_STATUS_META)
  const otherStatus = tickets.filter((t) => !statuses.includes(t.status)).length
  const emailOutcomes = batches.reduce<Record<string, number>>((acc, b) => ({ ...acc, [b.status]: (acc[b.status] ?? 0) + 1 }), {})
  const batchTickets = batches.reduce((s, b) => s + b.total, 0)

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Ticket volume" description="Tickets created per day in the active import" />
        <CardBody>
          {daily.length === 0 ? (
            <EmptyState title="No ticket dates" />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={daily} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
                  <defs>
                    <linearGradient id="vol" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b6af5" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#3b6af5" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                  <Area type="monotone" dataKey="count" name="Tickets" stroke="#2550ea" strokeWidth={2} fill="url(#vol)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Priority distribution" />
          <CardBody>
            <BarsChart data={PRIORITIES.map((p) => ({ name: priorityMeta(p).label, value: dashboard.tickets.by_priority[p] ?? 0, color: priorityMeta(p).chart }))} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Status distribution" />
          <CardBody>
            <DonutChart
              centerLabel="tickets"
              data={[
                ...statuses.map((s) => ({ name: TICKET_STATUS_META[s].label, value: dashboard.tickets.by_status[s] ?? 0, color: TICKET_STATUS_META[s].chart })),
                ...(otherStatus ? [{ name: 'Other', value: otherStatus, color: '#cbd5e1' }] : []),
              ]}
            />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="SLA performance" description="Open tickets against their SLA target now; resolved tickets against the time they took. Only tickets with valid dates are measured." />
        <CardBody>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Resolved within SLA" value={measured ? percent(closed.met, measured) : '—'} hint={measured ? `${closed.met} of ${measured} measured` : 'No resolved tickets with dates'} />
            <Metric label="Open past SLA" value={String(dashboard.ticket_sla.open.breached)} />
            <Metric label="Open at risk" value={String(dashboard.ticket_sla.open.at_risk)} />
            <Metric label="Not measurable" value={String(dashboard.ticket_sla.open.unknown + closed.unknown)} hint="Missing or invalid dates" />
          </div>
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div>
              <p className="mb-3 text-sm font-medium text-slate-700">Open tickets</p>
              <DonutChart centerLabel="open" height={170} data={(['breached', 'at_risk', 'on_track', 'unknown'] as const).map((s) => ({ name: SLA_META[s].label, value: dashboard.ticket_sla.open[s], color: SLA_META[s].chart }))} />
            </div>
            <div>
              <p className="mb-3 text-sm font-medium text-slate-700">Resolved and closed tickets</p>
              <DonutChart centerLabel="closed" height={170} data={(['met', 'missed', 'unknown'] as const).map((s) => ({ name: SLA_META[s].label, value: closed[s], color: SLA_META[s].chart }))} />
            </div>
          </div>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Approval statistics" />
          <CardBody className="space-y-6">
            <div className="grid grid-cols-3 gap-3">
              <Metric label="Requests" value={String(dashboard.approvals.total)} />
              <Metric label="Approval rate" value={decided ? percent(dashboard.approvals.by_status.approved, decided) : '—'} hint={decided ? `of ${decided} decided` : 'None decided yet'} />
              <Metric label="Overdue now" value={String(dashboard.approvals.overdue_responses)} />
            </div>
            <DonutChart centerLabel="requests" height={170} data={(['pending', 'info_requested', 'approved', 'rejected'] as const).map((s) => ({ name: APPROVAL_META[s].label, value: dashboard.approvals.by_status[s], color: APPROVAL_META[s].chart }))} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Manager response time" description="From the first email to the manager's first decision or question" />
          <CardBody>
            {times.length === 0 ? (
              <EmptyState title="No responses yet" description="This appears once the manager has acted on an emailed request." />
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-3 gap-3">
                  <Metric label="Median" value={formatHours(median)} />
                  <Metric label="Average" value={formatHours(average)} />
                  <Metric label="Within target" value={percent(withinTarget, times.length)} hint={`${times.length} responses`} />
                </div>
                <BarsChart data={buckets} height={180} />
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Batch statistics" />
        <CardBody>
          {batches.length === 0 ? (
            <EmptyState title="No batches yet" />
          ) : (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Batches" value={String(batches.length)} />
                <Metric label="Tickets sent" value={String(batchTickets)} />
                <Metric label="Average batch size" value={(batchTickets / batches.length).toFixed(1)} />
                <Metric label="Reminder emails" value={String(batches.reduce((s, b) => s + b.emails.filter((e) => e.kind === 'reminder').length, 0))} />
              </div>
              <div>
                <p className="mb-3 text-sm font-medium text-slate-700">Email outcome per batch</p>
                <BarsChart
                  layout="horizontal-bars"
                  height={180}
                  data={Object.entries(emailOutcomes).map(([status, n]) => ({
                    name: DELIVERY_META[status as Batch['status']]?.label ?? status,
                    value: n,
                    color: status === 'sent' ? '#10b981' : status === 'email_failed' ? '#e11d48' : '#0ea5e9',
                  }))}
                />
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

export default function ReportsPage() {
  const tickets = useApi((signal) => api.tickets(signal), [])
  const approvals = useApi((signal) => api.approvals({}, signal), [])
  const batches = useApi((signal) => api.batches(signal), [])
  const dashboard = useApi((signal) => api.dashboard(signal), [])
  const sources = [tickets, approvals, batches, dashboard]
  const failed = sources.find((s) => s.error && !s.data)

  return (
    <>
      <PageHeader title="Reports & Analytics" description="Calculated from the live backend data. Metrics that the data cannot support are shown as not available." updatedAt={dashboard.updatedAt} />
      {failed?.error ? (
        <Card>
          <ErrorState error={failed.error} onRetry={() => sources.forEach((s) => s.reload())} />
        </Card>
      ) : tickets.data && approvals.data && batches.data && dashboard.data ? (
        <Reports tickets={tickets.data.tickets} approvals={approvals.data} batches={batches.data} dashboard={dashboard.data} />
      ) : (
        <div className="space-y-6" role="status" aria-label="Loading reports">
          <Skeleton className="h-72 w-full" />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        </div>
      )}
    </>
  )
}
