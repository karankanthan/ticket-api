import { Link } from 'react-router'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Clock,
  HelpCircle,
  Inbox,
  ListChecks,
  Mail,
  RefreshCw,
  Ticket,
  XCircle,
} from 'lucide-react'
import { api } from '../api/endpoints'
import type { Dashboard } from '../api/types'
import { BarsChart, DonutChart } from '../components/charts'
import { DeliveryBadge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, CardBody, CardHeader } from '../components/ui/Card'
import { EmptyState, ErrorState, InlineAlert, Skeleton } from '../components/ui/Feedback'
import { PageHeader, StatCard } from '../components/ui/Layout'
import { useApi } from '../hooks/useApi'
import { formatDateTime, formatNumber, timeAgo } from '../lib/format'
import { APPROVAL_META, EVENT_LABELS, PRIORITIES, SLA_META, priorityMeta } from '../lib/meta'

const DASHBOARD_POLL_MS = 20_000

function EmailBanner({ email }: { email: Dashboard['email'] }) {
  if (!email.ready) {
    return (
      <InlineAlert tone="error" icon={<AlertTriangle className="size-4" />} title="Email is not configured">
        Missing settings: {email.missing_settings.join(', ')}. Batches cannot be emailed until this is fixed.{' '}
        <Link to="/settings" className="font-medium underline">
          View settings
        </Link>
      </InlineAlert>
    )
  }
  if (!email.delivers_real_email) {
    return (
      <InlineAlert tone="info" icon={<Mail className="size-4" />} title={`Local email mode (${email.backend})`}>
        Manager emails are {email.backend === 'file' ? 'saved as .eml files in the outbox' : 'printed in the backend console'} and are not delivered.
        Configure SMTP for real delivery.
      </InlineAlert>
    )
  }
  return null
}

export default function DashboardPage() {
  const dashboard = useApi((signal) => api.dashboard(signal), [], { pollMs: DASHBOARD_POLL_MS })
  const activity = useApi((signal) => api.activity(8, undefined, signal), [], { pollMs: DASHBOARD_POLL_MS })
  const d = dashboard.data

  if (dashboard.error && !d) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <Card>
          <ErrorState error={dashboard.error} onRetry={dashboard.reload} />
        </Card>
      </>
    )
  }

  const loading = !d
  const open = d ? (d.tickets.by_status.open ?? 0) + (d.tickets.by_status.in_progress ?? 0) : 0
  const resolved = d ? (d.tickets.by_status.resolved ?? 0) + (d.tickets.by_status.closed ?? 0) : 0
  const priorityData = PRIORITIES.map((p) => ({ name: priorityMeta(p).label, value: d?.tickets.by_priority[p] ?? 0, color: priorityMeta(p).chart }))
  const slaData = (['breached', 'at_risk', 'on_track', 'unknown'] as const).map((s) => ({ name: SLA_META[s].label, value: d?.ticket_sla.open[s] ?? 0, color: SLA_META[s].chart }))
  const approvalData = (['pending', 'info_requested', 'approved', 'rejected'] as const).map((s) => ({ name: APPROVAL_META[s].label, value: d?.approvals.by_status[s] ?? 0, color: APPROVAL_META[s].chart }))
  const latest = d?.batches.latest

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Live overview of tickets, SLA and manager approvals. Refreshes automatically."
        updatedAt={dashboard.updatedAt}
        actions={
          <Button onClick={dashboard.reload} loading={dashboard.refreshing} icon={<RefreshCw className="size-4" />}>
            Refresh
          </Button>
        }
      />
      {dashboard.error && d && (
        <div className="mb-4">
          <InlineAlert tone="warning" title="Showing the last loaded data">
            The latest refresh failed: {dashboard.error.message}
          </InlineAlert>
        </div>
      )}
      {d && (
        <div className="mb-6">
          <EmailBanner email={d.email} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total tickets" value={formatNumber(d?.tickets.total)} icon={<Ticket className="size-5" />} loading={loading} />
        <StatCard label="Open tickets" value={formatNumber(open)} icon={<CircleDot className="size-5" />} tone="sky" loading={loading} hint={d && `${d.ticket_sla.open.breached} past SLA`} />
        <StatCard label="Resolved tickets" value={formatNumber(resolved)} icon={<CheckCircle2 className="size-5" />} tone="emerald" loading={loading} />
        <StatCard
          label="Approval queue"
          value={formatNumber(d?.queue.queued)}
          icon={<ListChecks className="size-5" />}
          tone="violet"
          loading={loading}
          hint={
            <Link to="/control-center" className="inline-flex items-center gap-1 font-medium text-brand-600 hover:text-brand-700">
              Open Control Center <ArrowRight className="size-3" />
            </Link>
          }
        />
        <StatCard
          label="Pending manager approval"
          value={formatNumber(d?.approvals.by_status.pending)}
          icon={<Clock className="size-5" />}
          tone="amber"
          loading={loading}
          hint={d && (d.approvals.overdue_responses ? <span className="font-medium text-red-600">{d.approvals.overdue_responses} past response target</span> : 'None past response target')}
        />
        <StatCard label="Approved" value={formatNumber(d?.approvals.by_status.approved)} icon={<CheckCircle2 className="size-5" />} tone="emerald" loading={loading} />
        <StatCard label="Rejected" value={formatNumber(d?.approvals.by_status.rejected)} icon={<XCircle className="size-5" />} tone="rose" loading={loading} />
        <StatCard label="More info requested" value={formatNumber(d?.approvals.by_status.info_requested)} icon={<HelpCircle className="size-5" />} tone="slate" loading={loading} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader title="Priority distribution" description="All imported tickets" />
          <CardBody>{loading ? <Skeleton className="h-56 w-full" /> : <BarsChart data={priorityData} height={220} />}</CardBody>
        </Card>
        <Card>
          <CardHeader title="SLA performance" description="Open and in-progress tickets" />
          <CardBody>{loading ? <Skeleton className="h-56 w-full" /> : <DonutChart data={slaData} centerLabel="open" height={180} />}</CardBody>
        </Card>
        <Card>
          <CardHeader title="Approval requests" description="By current status" />
          <CardBody>{loading ? <Skeleton className="h-56 w-full" /> : <DonutChart data={approvalData} centerLabel="requests" height={180} />}</CardBody>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Recent activity"
            action={
              <Link to="/activity" className="text-sm font-medium text-brand-600 hover:text-brand-700">
                View all
              </Link>
            }
          />
          {activity.error && !activity.data ? (
            <ErrorState compact error={activity.error} onRetry={activity.reload} />
          ) : !activity.data ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : activity.data.length === 0 ? (
            <EmptyState icon={<Inbox className="size-6" />} title="No activity yet" description="Imports, batches and decisions will appear here." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {activity.data.map((entry) => (
                <li key={entry.event_id} className="flex items-start gap-3 px-5 py-3">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-500" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-900">{entry.message}</p>
                    <p className="text-xs text-slate-500">{EVENT_LABELS[entry.event] ?? entry.event}</p>
                  </div>
                  <time className="shrink-0 text-xs text-slate-400" dateTime={entry.at} title={formatDateTime(entry.at)}>
                    {timeAgo(entry.at)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Latest batch"
            action={
              <Link to="/batches" className="text-sm font-medium text-brand-600 hover:text-brand-700">
                All batches
              </Link>
            }
          />
          <CardBody>
            {loading ? (
              <Skeleton className="h-32 w-full" />
            ) : !latest ? (
              <EmptyState title="No batches yet" description="Send tickets to the manager from the Control Center." />
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-mono text-sm font-semibold text-slate-900">{latest.batch_id}</p>
                    <p className="text-xs text-slate-500">{formatDateTime(latest.created_at)}</p>
                  </div>
                  <DeliveryBadge status={latest.status} />
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {(['pending', 'info_requested', 'approved', 'rejected'] as const).map((s) => (
                    <div key={s} className="rounded-lg bg-slate-50 px-3 py-2">
                      <p className="text-xs text-slate-500">{APPROVAL_META[s].label}</p>
                      <p className="tabular text-lg font-semibold text-slate-900">{latest.counts[s]}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  )
}
