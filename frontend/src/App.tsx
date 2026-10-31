import { lazy, Suspense } from 'react'
import { Link, Route, Routes } from 'react-router'
import { AppLayout } from './components/layout/AppLayout'
import { EmptyState, Skeleton } from './components/ui/Feedback'
import { ToastProvider } from './components/ui/Toast'

const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const TicketsPage = lazy(() => import('./pages/TicketsPage'))
const ImportPage = lazy(() => import('./pages/ImportPage'))
const ControlCenterPage = lazy(() => import('./pages/ControlCenterPage'))
const ApprovalsPage = lazy(() => import('./pages/ApprovalsPage'))
const BatchesPage = lazy(() => import('./pages/BatchesPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const ActivityPage = lazy(() => import('./pages/ActivityPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const ManagerActionPage = lazy(() => import('./pages/ManagerActionPage'))

function PageFallback() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading page">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      description="This page does not exist."
      action={
        <Link to="/" className="text-sm font-medium text-brand-600">
          Go to the dashboard
        </Link>
      }
    />
  )
}

export default function App() {
  return (
    <ToastProvider>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          {/* Manager decision page: opened from email links, no sign-in, no app chrome. */}
          <Route path="/act/:token" element={<ManagerActionPage />} />
          <Route element={<AppLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="tickets" element={<TicketsPage />} />
            <Route path="import" element={<ImportPage />} />
            <Route path="control-center" element={<ControlCenterPage />} />
            <Route path="approvals" element={<ApprovalsPage />} />
            <Route path="batches" element={<BatchesPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="activity" element={<ActivityPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>
    </ToastProvider>
  )
}
