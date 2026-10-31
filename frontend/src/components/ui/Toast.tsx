import { useCallback, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { cx } from '../../lib/format'
import { ToastContext, type ToastInput } from './toastContext'

interface ToastItem extends ToastInput {
  id: number
}

const ICONS = {
  success: <CheckCircle2 className="size-5 text-emerald-600" />,
  error: <XCircle className="size-5 text-red-600" />,
  warning: <AlertTriangle className="size-5 text-amber-600" />,
  info: <Info className="size-5 text-sky-600" />,
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), [])

  const push = useCallback(
    (toast: ToastInput) => {
      const id = nextId.current++
      setToasts((all) => [...all.slice(-3), { ...toast, id }])
      window.setTimeout(() => dismiss(id), toast.tone === 'error' ? 8000 : 5000)
    },
    [dismiss],
  )

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            className={cx('pointer-events-auto flex w-full max-w-sm animate-toast-in items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-pop')}
          >
            {ICONS[toast.tone ?? 'info']}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">{toast.title}</p>
              {toast.description && <p className="mt-0.5 text-sm text-slate-600">{toast.description}</p>}
            </div>
            <button onClick={() => dismiss(toast.id)} className="rounded p-0.5 text-slate-400 hover:text-slate-600" aria-label="Dismiss notification">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
