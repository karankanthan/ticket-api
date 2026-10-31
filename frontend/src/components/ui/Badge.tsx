import type { ReactNode } from 'react'
import type { ApprovalState, BatchStatus, DeliveryStatus, SlaState } from '../../api/types'
import { cx, formatHours } from '../../lib/format'
import { APPROVAL_META, DELIVERY_META, SLA_META, TICKET_STATUS_META, priorityMeta } from '../../lib/meta'

export function Badge({ className, children, title }: { className?: string; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cx('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset', className)}
    >
      {children}
    </span>
  )
}

export function PriorityBadge({ priority }: { priority: string | null | undefined }) {
  const meta = priorityMeta(priority)
  return (
    <Badge className={meta.badge}>
      <span className={cx('size-1.5 rounded-full', meta.dot)} aria-hidden />
      {meta.label}
    </Badge>
  )
}

export function TicketStatusBadge({ status }: { status: string | null | undefined }) {
  const meta = TICKET_STATUS_META[status ?? ''] ?? { label: status || 'Unknown', badge: 'bg-slate-100 text-slate-600 ring-slate-500/20' }
  return <Badge className={meta.badge}>{meta.label}</Badge>
}

export function ApprovalBadge({ status }: { status: ApprovalState | string }) {
  const meta = APPROVAL_META[status as ApprovalState] ?? { label: status, badge: 'bg-slate-100 text-slate-600 ring-slate-500/20' }
  return <Badge className={meta.badge}>{meta.label}</Badge>
}

export function SlaBadge({ state, remaining }: { state: SlaState; remaining?: number | null }) {
  const meta = SLA_META[state] ?? SLA_META.unknown
  let text = meta.label
  if (remaining !== null && remaining !== undefined) {
    if (state === 'breached') text = `Breached ${formatHours(remaining)} ago`
    else if (state === 'at_risk' || state === 'on_track') text = `${formatHours(remaining)} left`
  }
  return <Badge className={meta.badge}>{text}</Badge>
}

export function DeliveryBadge({ status }: { status: DeliveryStatus | BatchStatus }) {
  const meta = DELIVERY_META[status] ?? { label: status, badge: 'bg-slate-100 text-slate-600 ring-slate-500/20', description: '' }
  return (
    <Badge className={meta.badge} title={meta.description}>
      {meta.label}
    </Badge>
  )
}
