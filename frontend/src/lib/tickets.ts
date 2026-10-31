import type { Ticket } from '../api/types'
import { parseDate } from './format'

export const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 }
const SEARCH_FIELDS: (keyof Ticket)[] = ['ticket_id', 'subject', 'description', 'category', 'assigned_to', 'labels', 'status', 'priority']

export type TicketSortKey = 'ticket_id' | 'created_at' | 'priority' | 'status' | 'sla' | 'category'

export interface TicketFilters {
  priority: string
  status: string
  category: string
  assignee: string
  approval: string
  sla: string
}

export const NO_FILTERS: TicketFilters = { priority: '', status: '', category: '', assignee: '', approval: '', sla: '' }

export function filterTickets(tickets: Ticket[], query: string, filters: TicketFilters): Ticket[] {
  const q = query.trim().toLowerCase()
  return tickets.filter((t) => {
    if (q && !SEARCH_FIELDS.some((f) => String(t[f] ?? '').toLowerCase().includes(q))) return false
    if (filters.priority && t.priority !== filters.priority) return false
    if (filters.status && t.status !== filters.status) return false
    if (filters.category && t.category !== filters.category) return false
    if (filters.assignee && (t.assigned_to || '(unassigned)') !== filters.assignee) return false
    if (filters.approval && t.approval.status !== filters.approval) return false
    if (filters.sla && t.sla.state !== filters.sla) return false
    return true
  })
}

function sortValue(t: Ticket, key: TicketSortKey): number | string {
  switch (key) {
    case 'created_at':
      return parseDate(t.created_at)?.getTime() ?? 0
    case 'priority':
      return PRIORITY_ORDER[t.priority] ?? 9
    case 'sla':
      return t.sla.remaining_hours ?? Number.POSITIVE_INFINITY
    default:
      return (t[key] ?? '').toString().toLowerCase()
  }
}

export function sortTickets(tickets: Ticket[], key: TicketSortKey, dir: 'asc' | 'desc'): Ticket[] {
  const factor = dir === 'asc' ? 1 : -1
  return [...tickets].sort((a, b) => {
    const av = sortValue(a, key)
    const bv = sortValue(b, key)
    return av < bv ? -factor : av > bv ? factor : a.ticket_id.localeCompare(b.ticket_id)
  })
}
