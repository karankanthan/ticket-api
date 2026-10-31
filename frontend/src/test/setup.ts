import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Recharts' ResponsiveContainer needs ResizeObserver, which jsdom does not provide.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver

// Pages are lazy-loaded; the first load of a chart page can take over a second in jsdom.
configure({ asyncUtilTimeout: 5000 })

// Load the lazy pages before any test runs. Otherwise the first test to open a chart page
// also pays for loading Recharts, and under parallel test workers that occasionally
// exceeded the wait above (the navigation test failed 1 run in 4).
await Promise.all([
  import('../pages/DashboardPage'),
  import('../pages/TicketsPage'),
  import('../pages/ImportPage'),
  import('../pages/ControlCenterPage'),
  import('../pages/ApprovalsPage'),
  import('../pages/BatchesPage'),
  import('../pages/ReportsPage'),
  import('../pages/ActivityPage'),
  import('../pages/SettingsPage'),
  import('../pages/TriagePage'),
  import('../pages/ManagerActionPage'),
])

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
  sessionStorage.clear()
})
