// Shapes returned by the FastAPI backend (app/admin_api.py, app/manager_actions.py).

export type Priority = 'urgent' | 'high' | 'normal' | 'low'
export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed'
export type RequestStatus = 'pending' | 'info_requested' | 'approved' | 'rejected'
export type ApprovalState = RequestStatus | 'queued' | 'none'
export type SlaState = 'breached' | 'at_risk' | 'on_track' | 'met' | 'missed' | 'unknown'
export type DeliveryStatus = 'sent' | 'saved_to_outbox' | 'printed_to_console' | 'failed'
export type BatchStatus = DeliveryStatus | 'email_failed' | 'sending'

export interface Sla {
  target_hours: number | null
  due_at: string | null
  elapsed_hours: number | null
  remaining_hours: number | null
  state: SlaState
  reason: string | null
}

export interface TicketApprovalSummary {
  status: ApprovalState
  request_id: string | null
  batch_id: string | null
  decided_at: string | null
  queue_item_id: string | null
  queue_reasons: string[]
}

export interface TicketBrief {
  ticket_id: string
  created_at: string
  resolved_at: string
  category: string
  priority: string
  status: string
  refund_amount: number | null
}

export interface Ticket extends TicketBrief {
  assigned_to: string
  labels: string
  subject: string
  description: string
  team_account_closing: boolean
  employee_email?: string
  sla: Sla
  approval: TicketApprovalSummary
}

export interface TicketList {
  total: number
  generated_at: string
  tickets: Ticket[]
}

export interface HistoryEntry {
  event: string
  status: string
  via: string
  note: string | null
  at: string
}

export interface ResponseInfo {
  target_hours: number
  due_at: string | null
  waiting_hours: number | null
  overdue: boolean
}

export interface EmployeeNotification {
  decision: RequestStatus
  recipient: string
  status: DeliveryStatus | 'skipped'
  reason: string | null
  error: string | null
  at: string
}

export interface ApprovalRequest {
  request_id: string
  ticket_id: string
  refund_amount: number | null
  team_account_closing: boolean
  escalated: boolean
  escalation_reasons: string[]
  status: RequestStatus
  note: string | null
  source: string | null
  batch_id: string | null
  created_at: string | null
  updated_at: string | null
  decided_at: string | null
  emailed_at: string | null
  reminders_sent: number | null
  last_reminder_at: string | null
  ticket: Partial<TicketBrief>
  history: HistoryEntry[]
  response?: ResponseInfo
  /** Masked, e.g. "a***@company.com"; empty when the ticket has no employee email. */
  employee_email?: string
  employee_notifications?: EmployeeNotification[]
  /** Latest email that carried this request's links (null when it was never emailed). */
  delivery?: { kind: string; status: DeliveryStatus; delivered: boolean; error: string | null; at: string } | null
}

export interface TicketDetail extends Ticket {
  requests: ApprovalRequest[]
}

export interface QueueItem {
  item_id: string
  ticket_id: string
  source: 'auto' | 'manual' | 'resubmission'
  reasons: string[]
  refund_amount: number | null
  team_account_closing: boolean
  note: string | null
  status: 'queued' | 'submitted' | 'dismissed' | 'withdrawn'
  request_id: string | null
  batch_id: string | null
  created_at: string
  updated_at: string
  ticket: TicketBrief | null
  sla: Sla | null
  rank?: number
}

export interface QueueResponse {
  total: number
  items: QueueItem[]
}

export interface EmailDeliveryRecord {
  verified: boolean
  last_success_at: string | null
  last_attempt_at: string | null
  last_attempt_status: string | null
  last_error: string | null
}

export interface EmailStatus {
  backend: 'console' | 'file' | 'smtp'
  delivers_real_email: boolean
  ready: boolean
  smtp_configured: boolean
  gmail: boolean
  delivery: EmailDeliveryRecord
  missing_settings: string[]
  warnings: string[]
  manager_email: string
  manager_email_configured: boolean
  email_from: string
  smtp_host: string
  smtp_port: number | null
  smtp_security: string
  smtp_auth_configured: boolean
  outbox_dir: string
  public_base_url: string
}

export interface PreviewResponse {
  mode: 'top' | 'manual'
  requested: number
  selected_count: number
  items: QueueItem[]
  item_ids: string[]
  warnings: string[]
  email: EmailStatus
}

export interface EmailAttempt {
  kind: 'initial' | 'resend' | 'reminder'
  status: DeliveryStatus
  delivered: boolean
  backend: string
  recipient: string
  attempts: number
  error: string | null
  at: string
  links_expire_at: string | null
  subject: string
  request_ids: string[]
  outbox_file: string | null
}

export interface Batch {
  batch_id: string
  created_at: string
  updated_at: string | null
  status: BatchStatus
  item_ids: string[]
  request_ids: string[]
  note: string | null
  selection: { mode: string; count?: number | null; priorities?: string[] | null } | null
  counts: Record<RequestStatus, number>
  total: number
  priorities: Record<string, number>
  emails: EmailAttempt[]
}

export interface BatchDetail extends Batch {
  requests: ApprovalRequest[]
}

export interface ActivityEntry {
  event_id: string
  event: string
  message: string
  details: Record<string, unknown>
  at: string
}

export interface Dashboard {
  generated_at: string
  tickets: { total: number; by_status: Record<string, number>; by_priority: Record<string, number> }
  ticket_sla: {
    open: Record<'breached' | 'at_risk' | 'on_track' | 'unknown', number>
    closed: Record<'met' | 'missed' | 'unknown', number>
  }
  approvals: {
    total: number
    by_status: Record<RequestStatus, number>
    pending_emailed: number
    pending_not_emailed: number
    overdue_responses: number
  }
  queue: { queued: number; by_priority: Record<string, number> }
  batches: { total: number; latest: Batch | null }
  email: EmailStatus
  automation: { enabled: boolean; last_run_at: string | null; last_error: string | null }
}

export interface Health {
  status: string
  tickets_loaded: number
  store_dir_writable: boolean
  email_backend: string
  email_ready: boolean
  scheduler_enabled: boolean
  scheduler_last_run_at: string | null
}

export interface ImportField {
  field: string
  label: string
  required: boolean
}

export interface ImportRowError {
  row: number
  ticket_id: string
  field: string
  message: string
}

export type ColumnMapping = Record<string, string | null>

export interface ImportPreview {
  filename: string
  delimiter: string
  columns: string[]
  row_count: number
  sample_rows: Record<string, string>[]
  mapping: ColumnMapping
  fields: ImportField[]
  excluded_sensitive_columns: string[]
  date_formats: string[]
  date_format: string
  ready: boolean
  mapping_error: string | null
  valid_rows: number
  invalid_rows: number | null
  errors: ImportRowError[]
  errors_truncated?: boolean
  warnings: string[]
  normalized_sample: Record<string, string>[]
}

export interface AnalysisSummary {
  analysed: number
  detected: number
  added: number
  updated: number
  withdrawn: number
  skipped: number
}

export interface ImportEntry {
  import_id: string
  filename: string
  created_at: string
  status: 'completed' | 'failed'
  total_rows: number | null
  valid_rows: number | null
  invalid_rows: number | null
  imported_rows: number
  date_format: string
  mapping: ColumnMapping
  error: string | null
  file: string | null
  analysis: AnalysisSummary | null
}

export interface ImportHistory {
  active_file: string
  imports: ImportEntry[]
}

export interface AppSettings {
  environment: {
    app_env: string
    admin_key_required: boolean
    scheduler_enabled: boolean
    scheduler_interval_seconds: number
    public_base_url: string
    ticket_data_file: string
    tickets_loaded: number
    store_dir: string
  }
  sla: {
    ticket_sla_hours: Record<Priority, number>
    approval_response_hours: Record<Priority, number>
    at_risk_fraction: number
  }
  reminders: { after_hours: number[]; max_reminders: number; action_link_ttl_hours: number }
  approval_rules: { rule: string; description: string }[]
  batches: { max_batch_size: number }
  employee_notifications?: { enabled: boolean; allowed_domains: string[]; source: string }
  email: EmailStatus
}

export interface AutomationResult {
  ran_at: string
  reminder_emails: { status: string; error: string | null; request_ids: string[] }[]
  newly_overdue_requests: string[]
  newly_breached_tickets: string[]
}

export interface TestEmailResult {
  status: DeliveryStatus
  delivered: boolean
  backend: string
  recipient: string
  attempts: number
  error: string | null
  at: string
  outbox_file: string | null
}

export type ManagerAction = 'approve' | 'reject' | 'need_more_info'
export type ManagerState =
  | 'ready'
  | 'done'
  | 'invalid'
  | 'expired'
  | 'used'
  | 'revoked'
  | 'decided'
  | 'needs_confirmation'
  | 'invalid_note'

export interface ManagerOutcome {
  state: ManagerState
  message: string
  action: ManagerAction | null
  note_required: boolean
  note_max_length: number
  expires_at: string | null
  request: {
    request_id: string
    ticket_id: string
    priority: string | null
    category: string | null
    ticket_status: string | null
    ticket_created_at: string | null
    reasons: string[]
    refund_amount: number | null
    status: RequestStatus
    decided_at: string | null
    notes: { at: string; event: string; note: string }[]
  } | null
}
