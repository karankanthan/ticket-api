import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { ArrowDown, ArrowUp, ArrowUpDown, FilterX, Ticket as TicketIcon } from 'lucide-react'
import { api } from '../api/endpoints'
import { TicketDrawer } from '../components/TicketDrawer'
import { ApprovalBadge, PriorityBadge, SlaBadge, TicketStatusBadge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState, ErrorState, SkeletonRows } from '../components/ui/Feedback'
import { SearchInput, Select } from '../components/ui/Form'
import { PageHeader, Pagination } from '../components/ui/Layout'
import { useApi } from '../hooks/useApi'
import { cx, formatDateTime } from '../lib/format'
import { APPROVAL_META, PRIORITIES, SLA_META, TICKET_STATUS_META, priorityMeta } from '../lib/meta'
import { TD, TH } from '../lib/table'
import { NO_FILTERS, filterTickets, sortTickets, type TicketFilters, type TicketSortKey } from '../lib/tickets'

function SortHeader({ k, children, sort, onSort }: { k: TicketSortKey; children: string; sort: { key: TicketSortKey; dir: 'asc' | 'desc' }; onSort: (key: TicketSortKey) => void }) {
  const Icon = sort.key !== k ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <th className={TH} aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => onSort(k)} className="inline-flex items-center gap-1 uppercase hover:text-slate-800">
        {children}
        <Icon className={cx('size-3.5', sort.key !== k && 'opacity-40')} />
      </button>
    </th>
  )
}

const PAGE_SIZE = 25

export default function TicketsPage() {
  const tickets = useApi((signal) => api.tickets(signal), [])
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<TicketFilters>(NO_FILTERS)
  const [sort, setSort] = useState<{ key: TicketSortKey; dir: 'asc' | 'desc' }>({ key: 'created_at', dir: 'desc' })
  const [page, setPage] = useState(1)
  const openId = params.get('ticket')

  const all = useMemo(() => tickets.data?.tickets ?? [], [tickets.data])
  const options = useMemo(() => {
    const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort()
    return {
      categories: unique(all.map((t) => t.category)),
      assignees: unique(all.map((t) => t.assigned_to || '(unassigned)')),
      hasAssignees: all.some((t) => t.assigned_to),
    }
  }, [all])

  const rows = useMemo(() => sortTickets(filterTickets(all, query, filters), sort.key, sort.dir), [all, query, filters, sort])

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const visible = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const active = query !== '' || Object.values(filters).some(Boolean)

  function setFilter(key: keyof TicketFilters, value: string) {
    setFilters((f) => ({ ...f, [key]: value }))
    setPage(1)
  }

  function toggleSort(key: TicketSortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'created_at' ? 'desc' : 'asc' }))
  }

  function openTicket(id: string | null) {
    const next = new URLSearchParams(params)
    if (id) next.set('ticket', id)
    else next.delete('ticket')
    setParams(next, { replace: true })
  }

  return (
    <>
      <PageHeader
        title="All Tickets"
        description="Every ticket from the active CSV import, with SLA and approval status. Customer contact details are never shown."
        updatedAt={tickets.updatedAt}
      />

      <Card>
        <div className="space-y-3 border-b border-slate-100 p-4">
          <SearchInput
            placeholder="Search ticket ID, subject, description, category, assignee or labels"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(1)
            }}
            aria-label="Search tickets"
          />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            <Select aria-label="Filter by priority" value={filters.priority} onChange={(e) => setFilter('priority', e.target.value)}>
              <option value="">All priorities</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {priorityMeta(p).label}
                </option>
              ))}
            </Select>
            <Select aria-label="Filter by status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
              <option value="">All statuses</option>
              {Object.entries(TICKET_STATUS_META).map(([value, meta]) => (
                <option key={value} value={value}>
                  {meta.label}
                </option>
              ))}
            </Select>
            <Select aria-label="Filter by category" value={filters.category} onChange={(e) => setFilter('category', e.target.value)}>
              <option value="">All categories</option>
              {options.categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
            <Select aria-label="Filter by assignee" value={filters.assignee} onChange={(e) => setFilter('assignee', e.target.value)} disabled={!options.hasAssignees} title={options.hasAssignees ? undefined : 'This import has no assignee column'}>
              <option value="">All assignees</option>
              {options.assignees.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </Select>
            <Select aria-label="Filter by approval status" value={filters.approval} onChange={(e) => setFilter('approval', e.target.value)}>
              <option value="">Any approval status</option>
              {Object.entries(APPROVAL_META).map(([value, meta]) => (
                <option key={value} value={value}>
                  {meta.label}
                </option>
              ))}
            </Select>
            <Select aria-label="Filter by SLA" value={filters.sla} onChange={(e) => setFilter('sla', e.target.value)}>
              <option value="">Any SLA state</option>
              {Object.entries(SLA_META).map(([value, meta]) => (
                <option key={value} value={value}>
                  {meta.label}
                </option>
              ))}
            </Select>
          </div>
          {active && (
            <div className="flex items-center justify-between text-sm text-slate-500">
              <span>
                {rows.length} of {all.length} tickets match
              </span>
              <Button
                variant="ghost"
                size="sm"
                icon={<FilterX className="size-3.5" />}
                onClick={() => {
                  setQuery('')
                  setFilters(NO_FILTERS)
                  setPage(1)
                }}
              >
                Clear filters
              </Button>
            </div>
          )}
        </div>

        {tickets.error && !tickets.data ? (
          <ErrorState error={tickets.error} onRetry={tickets.reload} />
        ) : !tickets.data ? (
          <SkeletonRows rows={8} cols={7} />
        ) : all.length === 0 ? (
          <EmptyState icon={<TicketIcon className="size-6" />} title="No tickets loaded" description="Import a CSV file to see tickets here." />
        ) : rows.length === 0 ? (
          <EmptyState icon={<FilterX className="size-6" />} title="No tickets match" description="Try a different search or clear the filters." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50/70">
                  <tr>
                    <SortHeader k="ticket_id" sort={sort} onSort={toggleSort}>Ticket</SortHeader>
                    <SortHeader k="category" sort={sort} onSort={toggleSort}>Category</SortHeader>
                    <SortHeader k="priority" sort={sort} onSort={toggleSort}>Priority</SortHeader>
                    <SortHeader k="status" sort={sort} onSort={toggleSort}>Status</SortHeader>
                    <th className={TH}>Assignee</th>
                    <SortHeader k="created_at" sort={sort} onSort={toggleSort}>Created</SortHeader>
                    <SortHeader k="sla" sort={sort} onSort={toggleSort}>SLA</SortHeader>
                    <th className={TH}>Approval</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {visible.map((t) => (
                    <tr key={t.ticket_id} onClick={() => openTicket(t.ticket_id)} className="cursor-pointer hover:bg-slate-50">
                      <td className={TD}>
                        <button onClick={() => openTicket(t.ticket_id)} className="font-mono text-sm font-medium text-brand-700 hover:underline">
                          {t.ticket_id}
                        </button>
                        {t.subject && <p className="max-w-xs truncate text-xs text-slate-500">{t.subject}</p>}
                      </td>
                      <td className={TD}>{t.category || '—'}</td>
                      <td className={TD}>
                        <PriorityBadge priority={t.priority} />
                      </td>
                      <td className={TD}>
                        <TicketStatusBadge status={t.status} />
                      </td>
                      <td className={TD}>{t.assigned_to || <span className="text-slate-400">—</span>}</td>
                      <td className={cx(TD, 'whitespace-nowrap')}>{formatDateTime(t.created_at)}</td>
                      <td className={TD}>
                        <SlaBadge state={t.sla.state} remaining={t.sla.remaining_hours} />
                      </td>
                      <td className={TD}>
                        <ApprovalBadge status={t.approval.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={currentPage} pageSize={PAGE_SIZE} total={rows.length} onPage={setPage} />
          </>
        )}
      </Card>

      {openId && (
        <TicketDrawer
          ticketId={openId}
          onClose={() => {
            openTicket(null)
            tickets.reload()
          }}
        />
      )}
    </>
  )
}
