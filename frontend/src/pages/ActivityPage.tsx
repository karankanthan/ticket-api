import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ClipboardCheck, FileUp, History, Layers, Mail, Search as SearchIcon, ShieldAlert } from 'lucide-react'
import { api } from '../api/endpoints'
import type { ActivityEntry } from '../api/types'
import { Card } from '../components/ui/Card'
import { EmptyState, ErrorState, SkeletonRows } from '../components/ui/Feedback'
import { SearchInput, Select } from '../components/ui/Form'
import { PageHeader } from '../components/ui/Layout'
import { useApi } from '../hooks/useApi'
import { cx, formatDateTime, timeAgo } from '../lib/format'
import { EVENT_LABELS } from '../lib/meta'

function eventStyle(event: string): { icon: typeof History; tone: string } {
  if (event.endsWith('failed')) return { icon: AlertTriangle, tone: 'bg-red-50 text-red-600' }
  if (event === 'decision') return { icon: CheckCircle2, tone: 'bg-emerald-50 text-emerald-600' }
  if (event.startsWith('email')) return { icon: Mail, tone: 'bg-sky-50 text-sky-600' }
  if (event.startsWith('batch')) return { icon: Layers, tone: 'bg-violet-50 text-violet-600' }
  if (event.includes('import') || event === 'tickets_analysed') return { icon: FileUp, tone: 'bg-brand-50 text-brand-600' }
  if (event === 'approval_overdue' || event === 'sla_breached') return { icon: ShieldAlert, tone: 'bg-amber-50 text-amber-600' }
  if (event.startsWith('queue') || event.startsWith('request') || event === 'info_provided') return { icon: ClipboardCheck, tone: 'bg-indigo-50 text-indigo-600' }
  return { icon: History, tone: 'bg-slate-100 text-slate-600' }
}

function groupByDay(entries: ActivityEntry[]) {
  const groups: { day: string; entries: ActivityEntry[] }[] = []
  entries.forEach((e) => {
    const day = new Date(e.at).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    const last = groups[groups.length - 1]
    if (last?.day === day) last.entries.push(e)
    else groups.push({ day, entries: [e] })
  })
  return groups
}

export default function ActivityPage() {
  const [limit, setLimit] = useState(200)
  const activity = useApi((signal) => api.activity(limit, undefined, signal), [limit], { pollMs: 30_000 })
  const [type, setType] = useState('')
  const [query, setQuery] = useState('')

  const entries = useMemo(() => activity.data ?? [], [activity.data])
  const types = useMemo(() => [...new Set(entries.map((e) => e.event))].sort(), [entries])
  const filtered = entries.filter((e) => (!type || e.event === type) && (!query || e.message.toLowerCase().includes(query.toLowerCase())))

  return (
    <>
      <PageHeader title="Activity" description="Imports, batches, emails, reminders and manager decisions, newest first." updatedAt={activity.updatedAt} />
      <Card>
        <div className="flex flex-col gap-2 border-b border-slate-100 p-4 sm:flex-row">
          <SearchInput className="flex-1" placeholder="Search activity" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search activity" />
          <Select aria-label="Filter by type" className="sm:w-56" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All activity</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {EVENT_LABELS[t] ?? t}
              </option>
            ))}
          </Select>
          <Select aria-label="Number of entries" className="sm:w-36" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            {[50, 200, 500, 1000].map((n) => (
              <option key={n} value={n}>
                Last {n}
              </option>
            ))}
          </Select>
        </div>
        {activity.error && !activity.data ? (
          <ErrorState error={activity.error} onRetry={activity.reload} />
        ) : !activity.data ? (
          <SkeletonRows rows={8} cols={3} />
        ) : filtered.length === 0 ? (
          <EmptyState icon={entries.length ? <SearchIcon className="size-6" /> : <History className="size-6" />} title={entries.length ? 'Nothing matches' : 'No activity yet'} />
        ) : (
          <div className="px-5 py-4">
            {groupByDay(filtered).map((group) => (
              <section key={group.day} className="mb-6 last:mb-0">
                <h2 className="mb-3 text-xs font-semibold tracking-wide text-slate-500 uppercase">{group.day}</h2>
                <ol className="space-y-1">
                  {group.entries.map((e) => {
                    const style = eventStyle(e.event)
                    return (
                      <li key={e.event_id} className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-slate-50">
                        <span className={cx('mt-0.5 rounded-lg p-1.5', style.tone)}>
                          <style.icon className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-slate-900">{e.message}</p>
                          <p className="text-xs text-slate-500">{EVENT_LABELS[e.event] ?? e.event}</p>
                        </div>
                        <time dateTime={e.at} title={formatDateTime(e.at)} className="shrink-0 text-xs whitespace-nowrap text-slate-400">
                          {new Date(e.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} · {timeAgo(e.at)}
                        </time>
                      </li>
                    )
                  })}
                </ol>
              </section>
            ))}
          </div>
        )}
      </Card>
    </>
  )
}
