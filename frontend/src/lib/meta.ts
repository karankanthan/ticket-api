// Labels and colours for priorities, statuses and SLA states, shared by every page.
import type { ApprovalState, BatchStatus, DeliveryStatus, Priority, SlaState } from '../api/types'

export const PRIORITIES: Priority[] = ['urgent', 'high', 'normal', 'low']

export const PRIORITY_META: Record<Priority, { label: string; short: string; badge: string; dot: string; chart: string }> = {
  urgent: { label: 'P1 Urgent', short: 'P1', badge: 'bg-red-50 text-red-700 ring-red-600/20', dot: 'bg-red-500', chart: '#dc2626' },
  high: { label: 'P2 High', short: 'P2', badge: 'bg-orange-50 text-orange-700 ring-orange-600/20', dot: 'bg-orange-500', chart: '#ea580c' },
  normal: { label: 'P3 Normal', short: 'P3', badge: 'bg-blue-50 text-blue-700 ring-blue-600/20', dot: 'bg-blue-500', chart: '#2563eb' },
  low: { label: 'P4 Low', short: 'P4', badge: 'bg-slate-100 text-slate-600 ring-slate-500/20', dot: 'bg-slate-400', chart: '#94a3b8' },
}

export function priorityMeta(priority: string | null | undefined) {
  return PRIORITY_META[(priority ?? '') as Priority] ?? {
    label: priority || 'Unknown',
    short: '?',
    badge: 'bg-slate-100 text-slate-600 ring-slate-500/20',
    dot: 'bg-slate-300',
    chart: '#cbd5e1',
  }
}

export const TICKET_STATUS_META: Record<string, { label: string; badge: string; chart: string }> = {
  open: { label: 'Open', badge: 'bg-sky-50 text-sky-700 ring-sky-600/20', chart: '#0284c7' },
  in_progress: { label: 'In progress', badge: 'bg-violet-50 text-violet-700 ring-violet-600/20', chart: '#7c3aed' },
  resolved: { label: 'Resolved', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', chart: '#059669' },
  closed: { label: 'Closed', badge: 'bg-slate-100 text-slate-600 ring-slate-500/20', chart: '#64748b' },
}

export const APPROVAL_META: Record<ApprovalState, { label: string; badge: string; chart: string }> = {
  none: { label: 'No approval', badge: 'bg-white text-slate-500 ring-slate-300', chart: '#e2e8f0' },
  queued: { label: 'In queue', badge: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20', chart: '#6366f1' },
  pending: { label: 'Pending manager', badge: 'bg-amber-50 text-amber-800 ring-amber-600/20', chart: '#f59e0b' },
  info_requested: { label: 'Info requested', badge: 'bg-purple-50 text-purple-700 ring-purple-600/20', chart: '#9333ea' },
  approved: { label: 'Approved', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', chart: '#10b981' },
  rejected: { label: 'Rejected', badge: 'bg-rose-50 text-rose-700 ring-rose-600/20', chart: '#e11d48' },
}

export const SLA_META: Record<SlaState, { label: string; badge: string; chart: string }> = {
  breached: { label: 'Breached', badge: 'bg-red-50 text-red-700 ring-red-600/20', chart: '#dc2626' },
  at_risk: { label: 'At risk', badge: 'bg-amber-50 text-amber-800 ring-amber-600/20', chart: '#f59e0b' },
  on_track: { label: 'On track', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', chart: '#10b981' },
  met: { label: 'Met', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', chart: '#10b981' },
  missed: { label: 'Missed', badge: 'bg-rose-50 text-rose-700 ring-rose-600/20', chart: '#e11d48' },
  unknown: { label: 'Not available', badge: 'bg-slate-100 text-slate-500 ring-slate-400/20', chart: '#cbd5e1' },
}

/** Honest wording: only "sent" means a real email left the system. */
export const DELIVERY_META: Record<DeliveryStatus | BatchStatus, { label: string; badge: string; description: string }> = {
  sent: { label: 'Sent', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', description: 'Accepted by the SMTP server for delivery to the manager.' },
  saved_to_outbox: { label: 'Saved to outbox', badge: 'bg-sky-50 text-sky-700 ring-sky-600/20', description: 'Saved as an .eml file in the local outbox. Not delivered to anyone.' },
  printed_to_console: { label: 'Printed to console', badge: 'bg-sky-50 text-sky-700 ring-sky-600/20', description: 'Printed in the backend console. Not delivered to anyone.' },
  failed: { label: 'Failed', badge: 'bg-red-50 text-red-700 ring-red-600/20', description: 'The email was not sent.' },
  email_failed: { label: 'Email failed', badge: 'bg-red-50 text-red-700 ring-red-600/20', description: 'The email was not sent. The links in it were cancelled.' },
  sending: { label: 'Sending', badge: 'bg-slate-100 text-slate-600 ring-slate-500/20', description: 'The email is being prepared.' },
}

export const EVENT_LABELS: Record<string, string> = {
  request_created: 'Request created',
  decision: 'Manager decision',
  batch_submitted: 'Batch submitted',
  email_initial: 'Batch email',
  email_initial_failed: 'Batch email failed',
  email_resend: 'Email resent',
  email_resend_failed: 'Resend failed',
  email_reminder: 'Reminder email',
  email_reminder_failed: 'Reminder failed',
  email_test: 'Test email',
  tickets_analysed: 'Tickets analysed',
  tickets_imported: 'Tickets reloaded',
  csv_imported: 'CSV imported',
  import_failed: 'Import failed',
  queue_manual_add: 'Manual approval request',
  queue_dismissed: 'Removed from queue',
  info_provided: 'Information provided',
  approval_overdue: 'Response overdue',
  sla_breached: 'SLA breached',
}

export function reasonLabel(reason: string): string {
  if (reason === 'urgent ticket') return 'Urgent ticket'
  if (reason.startsWith('refund over')) return reason.replace('refund', 'Refund')
  if (reason === 'team account closing') return 'Team account closing'
  return reason
}
