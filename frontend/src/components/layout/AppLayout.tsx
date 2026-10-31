import { Suspense, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import {
  Activity,
  BarChart3,
  ClipboardCheck,
  FileUp,
  History,
  LayoutDashboard,
  Layers,
  Menu,
  RefreshCw,
  Settings,
  Ticket,
  Workflow,
  X,
} from 'lucide-react'
import { api } from '../../api/endpoints'
import { broadcastRefresh, useApi } from '../../hooks/useApi'
import { cx } from '../../lib/format'
import { Skeleton } from '../ui/Feedback'

interface NavItem {
  to: string
  label: string
  icon: typeof LayoutDashboard
  badge?: 'queue' | 'pending'
}

const NAV: { heading: string; items: NavItem[] }[] = [
  {
    heading: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/reports', label: 'Reports', icon: BarChart3 },
    ],
  },
  {
    heading: 'Tickets',
    items: [
      { to: '/tickets', label: 'All Tickets', icon: Ticket },
      { to: '/import', label: 'CSV Import', icon: FileUp },
    ],
  },
  {
    heading: 'Approvals',
    items: [
      { to: '/control-center', label: 'Control Center', icon: Workflow, badge: 'queue' },
      { to: '/approvals', label: 'Approval History', icon: ClipboardCheck, badge: 'pending' },
      { to: '/batches', label: 'Batch History', icon: Layers },
    ],
  },
  {
    heading: 'System',
    items: [
      { to: '/activity', label: 'Activity', icon: History },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
]

const TITLES: Record<string, string> = Object.fromEntries(NAV.flatMap((g) => g.items.map((i) => [i.to, i.label])))

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { data } = useApi((signal) => api.dashboard(signal), [], { pollMs: 30_000 })
  const counts = { queue: data?.queue.queued, pending: data ? data.approvals.by_status.pending + data.approvals.by_status.info_requested : undefined }

  return (
    <div className="flex h-full flex-col bg-ink-950 text-slate-300">
      <div className="flex h-16 items-center gap-2.5 px-5">
        <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-700 shadow-lg shadow-brand-900/40">
          <Activity className="size-4.5 text-white" strokeWidth={2.5} />
        </div>
        <div>
          <p className="text-[15px] font-semibold tracking-tight text-white">TicketFlow</p>
          <p className="text-[11px] text-slate-500">Helpdesk operations</p>
        </div>
      </div>
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4" aria-label="Main navigation">
        {NAV.map((group) => (
          <div key={group.heading}>
            <p className="px-3 pb-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">{group.heading}</p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const count = item.badge ? counts[item.badge] : undefined
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.to === '/'}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        cx(
                          'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                          isActive ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100',
                        )
                      }
                    >
                      <item.icon className="size-4.5 shrink-0" />
                      <span className="flex-1">{item.label}</span>
                      {!!count && (
                        <span className="tabular rounded-full bg-brand-500/20 px-2 py-0.5 text-[11px] font-semibold text-brand-200" aria-label={`${count} items`}>
                          {count}
                        </span>
                      )}
                    </NavLink>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-white/5 px-5 py-4 text-xs text-slate-500">
        Data from your FastAPI backend.
        <br />
        No database: JSON files on this computer.
      </div>
    </div>
  )
}

function BackendStatus() {
  const { data, error } = useApi((signal) => api.health(signal), [], { pollMs: 30_000 })
  const ok = data?.status === 'ok' && !error
  const label = error ? (error.status === 0 ? 'Backend offline' : 'Backend error') : ok ? 'Backend connected' : 'Connecting…'
  return (
    <span
      className={cx(
        'hidden items-center gap-2 rounded-full px-3 py-1 text-xs font-medium sm:inline-flex',
        error ? 'bg-red-50 text-red-700' : ok ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600',
      )}
      title={data ? `${data.tickets_loaded} tickets loaded · email: ${data.email_backend}` : undefined}
    >
      <span className={cx('size-2 rounded-full', error ? 'bg-red-500' : ok ? 'bg-emerald-500' : 'bg-slate-400')} />
      {label}
    </span>
  )
}

export function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  const title = TITLES[location.pathname] ?? 'TicketFlow'

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">
        <Sidebar />
      </aside>
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMenuOpen(false)} aria-hidden />
          <div className="relative h-full w-72 animate-slide-in">
            <button onClick={() => setMenuOpen(false)} className="absolute top-4 right-3 z-10 rounded-md p-1 text-slate-400 hover:text-white" aria-label="Close menu">
              <X className="size-5" />
            </button>
            <Sidebar onNavigate={() => setMenuOpen(false)} />
          </div>
        </div>
      )}
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/85 px-4 backdrop-blur sm:px-6 lg:px-8">
        <button onClick={() => setMenuOpen(true)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden" aria-label="Open menu">
          <Menu className="size-5" />
        </button>
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-500">
          TicketFlow <span className="mx-1.5 text-slate-300">/</span>
          <span className="text-slate-900">{title}</span>
        </p>
        <BackendStatus />
        <button
          onClick={broadcastRefresh}
          className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
          title="Reload data from the backend"
        >
          <RefreshCw className="size-4" />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </header>
      <main className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-[1400px]">
          <Suspense
            fallback={
              <div className="space-y-4" role="status" aria-label="Loading page">
                <Skeleton className="h-8 w-56" />
                <Skeleton className="h-4 w-96 max-w-full" />
                <Skeleton className="h-64 w-full" />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </div>
      </main>
    </div>
  )
}
