import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// The dev server forwards API calls to FastAPI so the browser only talks to one origin.
// /tickets and /act are browser pages in this app, so only API paths are forwarded.
// POST /triage is not forwarded: AI Triage is not part of the TicketFlow app (the backend
// endpoint is unchanged). Add '/triage' back here if TriagePage is ever routed again.
const PROXIED_PATHS = ['/api', '/health', '/summary', '/approval-requests']

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backend = env.VITE_BACKEND_URL || 'http://127.0.0.1:8000'
  const port = Number(env.VITE_PORT || 5173)

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port,
      proxy: Object.fromEntries(
        PROXIED_PATHS.map((path) => [path, { target: backend, changeOrigin: true }]),
      ),
    },
    preview: { port },
    test: {
      environment: 'jsdom',
      globals: true,
      // Each await in a test may take up to 5 s (asyncUtilTimeout in src/test/setup.ts), and
      // navigation tests wait several times, so the per-test budget must be larger than one wait.
      testTimeout: 15_000,
      setupFiles: ['./src/test/setup.ts'],
    },
  }
})
