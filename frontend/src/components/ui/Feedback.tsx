import type { ReactNode } from 'react'
import { AlertTriangle, Inbox, KeyRound, RefreshCw, WifiOff } from 'lucide-react'
import { Link } from 'react-router'
import type { ApiError } from '../../api/client'
import { cx } from '../../lib/format'
import { Button } from './Button'

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-slate-200/70', className)} aria-hidden />
}

export function SkeletonRows({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-slate-100" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-4 px-5 py-3.5">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className={cx('h-4', c === 0 ? 'w-24' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 rounded-full bg-slate-100 p-3 text-slate-400">{icon ?? <Inbox className="size-6" />}</div>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry, compact }: { error: ApiError | Error; onRetry?: () => void; compact?: boolean }) {
  const status = 'status' in error ? (error as ApiError).status : undefined
  const auth = status === 401
  const network = status === 0
  const Icon = auth ? KeyRound : network ? WifiOff : AlertTriangle
  const title = auth ? 'Admin key required' : network ? 'Backend not reachable' : 'Could not load data'
  return (
    <div role="alert" className={cx('flex flex-col items-center text-center', compact ? 'px-4 py-6' : 'px-6 py-12')}>
      <div className="mb-3 rounded-full bg-red-50 p-3 text-red-600">
        <Icon className="size-6" />
      </div>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-slate-600">{error.message}</p>
      <div className="mt-4 flex gap-2">
        {auth && (
          <Link to="/settings#admin-key" className="text-sm font-medium text-brand-600 hover:text-brand-700">
            Enter admin key
          </Link>
        )}
        {onRetry && (
          <Button size="sm" onClick={onRetry} icon={<RefreshCw className="size-3.5" />}>
            Try again
          </Button>
        )}
      </div>
    </div>
  )
}

export function InlineAlert({ tone = 'info', title, children, icon }: { tone?: 'info' | 'warning' | 'error' | 'success'; title?: ReactNode; children?: ReactNode; icon?: ReactNode }) {
  const tones = {
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    error: 'border-red-200 bg-red-50 text-red-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  }
  return (
    <div className={cx('flex gap-3 rounded-lg border px-4 py-3 text-sm', tones[tone])} role={tone === 'error' ? 'alert' : 'status'}>
      {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cx(title ? 'mt-0.5' : '', 'opacity-90')}>{children}</div>}
      </div>
    </div>
  )
}
