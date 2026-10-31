// Test fixtures shaped like the real backend responses. Used only by tests.
import type { ApprovalRequest, Batch, Dashboard, EmailStatus, ManagerOutcome, QueueItem, Sla, Ticket } from '../api/types'

export const fileEmail: EmailStatus = {
  backend: 'file',
  delivers_real_email: false,
  ready: true,
  smtp_configured: false,
  gmail: false,
  delivery: { verified: false, last_success_at: null, last_attempt_at: null, last_attempt_status: null, last_error: null },
  missing_settings: [],
  warnings: ['EMAIL_BACKEND=file: emails are not delivered to anyone.'],
  manager_email: '',
  manager_email_configured: false,
  email_from: '',
  smtp_host: '',
  smtp_port: null,
  smtp_security: '',
  smtp_auth_configured: false,
  outbox_dir: 'C:\\ticket-api\\data\\outbox',
  public_base_url: 'http://localhost:5173',
}

export function dashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  return {
    generated_at: '2026-10-30T12:00:00+05:30',
    tickets: { total: 120, by_status: { open: 37, in_progress: 42, resolved: 32, closed: 9 }, by_priority: { urgent: 14, high: 31, normal: 60, low: 15 } },
    ticket_sla: { open: { breached: 70, at_risk: 3, on_track: 6, unknown: 0 }, closed: { met: 0, missed: 0, unknown: 41 } },
    approvals: { total: 5, by_status: { pending: 2, info_requested: 1, approved: 1, rejected: 1 }, pending_emailed: 2, pending_not_emailed: 0, overdue_responses: 1 },
    queue: { queued: 8, by_priority: { urgent: 3, high: 2, normal: 3 } },
    batches: { total: 1, latest: null },
    email: fileEmail,
    automation: { enabled: true, last_run_at: null, last_error: null },
    ...overrides,
  }
}

const sla = (state: Sla['state'], remaining: number | null): Sla => ({
  target_hours: 4,
  due_at: null,
  elapsed_hours: remaining === null ? null : 4 - remaining,
  remaining_hours: remaining,
  state,
  reason: null,
})

export function ticket(id: string, overrides: Partial<Ticket> = {}): Ticket {
  return {
    ticket_id: id,
    created_at: '2026-10-29 09:00',
    resolved_at: '',
    category: 'Billing',
    priority: 'normal',
    status: 'open',
    refund_amount: null,
    assigned_to: 'riya',
    labels: '',
    subject: '',
    description: '',
    team_account_closing: false,
    sla: sla('on_track', 10),
    approval: { status: 'none', request_id: null, batch_id: null, decided_at: null, queue_item_id: null, queue_reasons: [] },
    ...overrides,
  }
}

export const tickets: Ticket[] = [
  ticket('TCK-1', { priority: 'urgent', category: 'Billing', subject: 'Charged twice', assigned_to: 'riya', sla: sla('breached', -5) }),
  ticket('TCK-2', { priority: 'high', category: 'Refunds', subject: 'Refund please', assigned_to: 'sam', refund_amount: 450 }),
  ticket('TCK-3', { priority: 'low', category: 'Shipping', subject: 'Parcel late', assigned_to: 'tom', status: 'resolved' }),
  ticket('TCK-4', { priority: 'normal', category: 'Login', subject: 'Cannot sign in', assigned_to: 'sam', approval: { status: 'pending', request_id: 'REQ-1', batch_id: 'BATCH-1', decided_at: null, queue_item_id: null, queue_reasons: [] } }),
]

export function queueItem(n: number, priority: Ticket['priority'], overrides: Partial<QueueItem> = {}): QueueItem {
  const id = `TCK-${100 + n}`
  return {
    item_id: `REC-${n}`,
    ticket_id: id,
    source: 'auto',
    reasons: priority === 'urgent' ? ['urgent ticket'] : ['refund over $200'],
    refund_amount: priority === 'urgent' ? null : 300 + n,
    team_account_closing: false,
    note: null,
    status: 'queued',
    request_id: null,
    batch_id: null,
    created_at: '2026-10-30T09:00:00+05:30',
    updated_at: '2026-10-30T09:00:00+05:30',
    ticket: { ticket_id: id, created_at: '2026-10-30 01:00', resolved_at: '', category: n % 2 ? 'Billing' : 'Refunds', priority, status: 'open', refund_amount: null },
    sla: sla(n < 3 ? 'breached' : 'on_track', n < 3 ? -n : n),
    rank: n,
    ...overrides,
  }
}

// 3 urgent, 2 high, 3 normal: 8 eligible
export const queue: QueueItem[] = [
  queueItem(1, 'urgent'),
  queueItem(2, 'urgent'),
  queueItem(3, 'urgent'),
  queueItem(4, 'high'),
  queueItem(5, 'high'),
  queueItem(6, 'normal'),
  queueItem(7, 'normal'),
  queueItem(8, 'normal'),
]

export function request(id: string, overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    request_id: id,
    ticket_id: 'TCK-101',
    refund_amount: null,
    team_account_closing: false,
    escalated: true,
    escalation_reasons: ['urgent ticket'],
    status: 'pending',
    note: null,
    source: 'control_center',
    batch_id: 'BATCH-1',
    created_at: '2026-10-30T10:00:00+05:30',
    updated_at: '2026-10-30T10:00:00+05:30',
    decided_at: null,
    emailed_at: '2026-10-30T10:00:00+05:30',
    reminders_sent: 0,
    last_reminder_at: null,
    ticket: { ticket_id: 'TCK-101', priority: 'urgent', category: 'Billing' },
    history: [{ event: 'created', status: 'pending', via: 'control_center', note: null, at: '2026-10-30T10:00:00+05:30' }],
    response: { target_hours: 4, due_at: '2026-10-30T14:00', waiting_hours: 1, overdue: false },
    ...overrides,
  }
}

export function batch(overrides: Partial<Batch> = {}): Batch {
  return {
    batch_id: 'BATCH-7',
    created_at: '2026-10-30T12:00:00+05:30',
    updated_at: '2026-10-30T12:00:00+05:30',
    status: 'saved_to_outbox',
    item_ids: ['REC-1', 'REC-2'],
    request_ids: ['REQ-10', 'REQ-11'],
    note: null,
    selection: { mode: 'manual' },
    counts: { pending: 2, info_requested: 0, approved: 0, rejected: 0 },
    total: 2,
    priorities: { urgent: 2 },
    emails: [
      {
        kind: 'initial',
        status: 'saved_to_outbox',
        delivered: false,
        backend: 'file',
        recipient: '',
        attempts: 1,
        error: null,
        at: '2026-10-30T12:00:00+05:30',
        links_expire_at: '2026-11-02T12:00',
        subject: 'Approval needed: 2 tickets (BATCH-7)',
        request_ids: ['REQ-10', 'REQ-11'],
        outbox_file: 'C:\\ticket-api\\data\\outbox\\x.eml',
      },
    ],
    ...overrides,
  }
}

export function managerOutcome(overrides: Partial<ManagerOutcome> = {}): ManagerOutcome {
  return {
    state: 'ready',
    message: '',
    action: 'approve',
    note_required: false,
    note_max_length: 1000,
    expires_at: '2026-11-02T12:00:00+05:30',
    request: {
      request_id: 'REQ-10',
      ticket_id: 'TCK-101',
      priority: 'urgent',
      category: 'Billing',
      ticket_status: 'open',
      ticket_created_at: '2026-10-30 01:00',
      reasons: ['urgent ticket'],
      refund_amount: 480,
      status: 'pending',
      decided_at: null,
      notes: [],
    },
    ...overrides,
  }
}
