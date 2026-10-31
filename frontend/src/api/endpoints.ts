import { request } from './client'
import type {
  ActivityEntry,
  ApprovalRequest,
  AppSettings,
  AutomationResult,
  Batch,
  BatchDetail,
  ColumnMapping,
  Dashboard,
  EmailStatus,
  Health,
  ImportEntry,
  ImportHistory,
  ImportPreview,
  ManagerOutcome,
  PreviewResponse,
  Priority,
  QueueItem,
  QueueResponse,
  TestEmailResult,
  TicketDetail,
  TicketList,
} from './types'

const enc = encodeURIComponent

export const api = {
  health: (signal?: AbortSignal) => request<Health>('/api/health', { signal }),
  dashboard: (signal?: AbortSignal) => request<Dashboard>('/api/dashboard', { signal }),

  tickets: (signal?: AbortSignal) => request<TicketList>('/api/tickets', { signal }),
  ticket: (id: string, signal?: AbortSignal) => request<TicketDetail>(`/api/tickets/${enc(id)}`, { signal }),

  queue: (signal?: AbortSignal) => request<QueueResponse>('/api/control-center/queue', { signal }),
  addToQueue: (body: { ticket_id: string; refund_amount?: number | null; team_account_closing?: boolean; note?: string | null }) =>
    request<QueueItem>('/api/control-center/queue', { method: 'POST', body }),
  dismiss: (itemId: string, reason?: string) =>
    request<QueueItem>(`/api/control-center/queue/${enc(itemId)}/dismiss`, { method: 'POST', body: { reason: reason || null } }),
  preview: (body: { mode: 'top' | 'manual'; count?: number; priorities?: Priority[]; item_ids?: string[] }) =>
    request<PreviewResponse>('/api/control-center/preview', { method: 'POST', body }),
  submitBatch: (body: { item_ids: string[]; note?: string | null; selection?: { mode: 'top' | 'manual'; count?: number; priorities?: Priority[] } }) =>
    request<Batch>('/api/control-center/batches', { method: 'POST', body }),
  /** Batch any tickets chosen in All Tickets (eligible or not); all-or-nothing on the server. */
  submitTicketsBatch: (ticketIds: string[], note?: string | null) =>
    request<Batch>('/api/control-center/batches', { method: 'POST', body: { ticket_ids: ticketIds, note: note || null } }),
  batches: (signal?: AbortSignal) => request<Batch[]>('/api/control-center/batches', { signal }),
  batch: (id: string, signal?: AbortSignal) => request<BatchDetail>(`/api/control-center/batches/${enc(id)}`, { signal }),
  resendBatch: (id: string) => request<Batch>(`/api/control-center/batches/${enc(id)}/resend`, { method: 'POST' }),
  reloadTickets: () => request<{ imported: number }>('/api/control-center/import', { method: 'POST' }),

  approvals: (params: { status?: string; batch_id?: string; ticket_id?: string } = {}, signal?: AbortSignal) => {
    const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString()
    return request<ApprovalRequest[]>(`/api/approvals${query ? `?${query}` : ''}`, { signal })
  },
  provideInfo: (requestId: string, note: string) =>
    request<{ request: ApprovalRequest; queue_item: QueueItem }>(`/api/approvals/${enc(requestId)}/provide-info`, {
      method: 'POST',
      body: { note },
    }),

  activity: (limit = 100, event?: string, signal?: AbortSignal) =>
    request<ActivityEntry[]>(`/api/activity?limit=${limit}${event ? `&event=${enc(event)}` : ''}`, { signal }),

  emailStatus: (signal?: AbortSignal) => request<EmailStatus>('/api/email/status', { signal }),
  testEmail: () => request<TestEmailResult>('/api/email/test', { method: 'POST', body: { confirm: true } }),
  settings: (signal?: AbortSignal) => request<AppSettings>('/api/settings', { signal }),
  runAutomation: () => request<AutomationResult>('/api/automation/run', { method: 'POST' }),

  importPreview: (body: { filename: string; content: string; mapping?: ColumnMapping | null; date_format?: string }) =>
    request<ImportPreview>('/api/imports/preview', { method: 'POST', body }),
  importCommit: (body: { filename: string; content: string; mapping: ColumnMapping; date_format: string; skip_invalid: boolean }) =>
    request<ImportEntry>('/api/imports', { method: 'POST', body }),
  importHistory: (signal?: AbortSignal) => request<ImportHistory>('/api/imports', { signal }),

  // Manager pages: no admin key, the link token is the credential.
  managerInspect: (token: string, signal?: AbortSignal) =>
    request<ManagerOutcome>(`/api/manager/actions/${enc(token)}`, { signal, admin: false }),
  managerDecide: (token: string, note: string) =>
    request<ManagerOutcome>(`/api/manager/actions/${enc(token)}`, {
      method: 'POST',
      body: { confirm: true, note },
      admin: false,
    }),
}
