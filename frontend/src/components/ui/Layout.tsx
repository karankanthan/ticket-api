import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cx, timeAgo } from '../../lib/format'
import { Skeleton } from './Feedback'

export function PageHeader({ title, description, actions, updatedAt }: { title: string; description?: ReactNode; actions?: ReactNode; updatedAt?: Date }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-slate-500">{description}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {updatedAt && <span className="text-xs text-slate-400">Updated {timeAgo(updatedAt)}</span>}
        {actions}
      </div>
    </div>
  )
}

export function StatCard({ label, value, icon, hint, tone = 'brand', loading }: { label: string; value: ReactNode; icon: ReactNode; hint?: ReactNode; tone?: 'brand' | 'amber' | 'emerald' | 'rose' | 'violet' | 'sky' | 'slate'; loading?: boolean }) {
  const tones = {
    brand: 'bg-brand-50 text-brand-600',
    amber: 'bg-amber-50 text-amber-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    rose: 'bg-rose-50 text-rose-600',
    violet: 'bg-violet-50 text-violet-600',
    sky: 'bg-sky-50 text-sky-600',
    slate: 'bg-slate-100 text-slate-600',
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <div className={cx('rounded-lg p-2', tones[tone])}>{icon}</div>
      </div>
      {loading ? <Skeleton className="mt-2 h-8 w-20" /> : <p className="tabular mt-1 text-3xl font-semibold tracking-tight text-slate-900">{value}</p>}
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  )
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: { value: T; label: ReactNode }[]; value: T | null; onChange: (value: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-slate-100 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cx(
            'rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors',
            value === option.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: string; count?: number }[]; value: T; onChange: (value: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          role="tab"
          aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
          className={cx(
            '-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap',
            value === tab.value ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700',
          )}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className={cx('tabular rounded-full px-2 py-0.5 text-xs', value === tab.value ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-600')}>{tab.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total ? (page - 1) * pageSize + 1 : 0
  const to = Math.min(total, page * pageSize)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
      <span className="tabular">
        Showing {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1">
        <button onClick={() => onPage(page - 1)} disabled={page <= 1} className="rounded-md p-1.5 hover:bg-slate-100 disabled:opacity-40" aria-label="Previous page">
          <ChevronLeft className="size-4" />
        </button>
        <span className="tabular px-2">
          Page {page} of {pages}
        </span>
        <button onClick={() => onPage(page + 1)} disabled={page >= pages} className="rounded-md p-1.5 hover:bg-slate-100 disabled:opacity-40" aria-label="Next page">
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  )
}

export function DefinitionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{item.label}</dt>
          <dd className="mt-0.5 text-sm break-words text-slate-900">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
