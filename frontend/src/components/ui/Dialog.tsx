import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, X } from 'lucide-react'
import { cx } from '../../lib/format'
import { Button } from './Button'

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])
}

interface ModalProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

const SIZES = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-3xl', xl: 'max-w-5xl' }

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: ModalProps) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  useEscape(open, onClose)
  useEffect(() => {
    if (open) panel.current?.focus()
  }, [open])
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div className="absolute inset-0 animate-fade-in bg-slate-900/50 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx('relative flex max-h-[92vh] w-full animate-fade-in flex-col rounded-t-2xl bg-white shadow-pop outline-none sm:rounded-2xl', SIZES[size])}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-slate-900">
              {title}
            </h2>
            {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-3.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

interface ConfirmProps {
  open: boolean
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  confirmLabel: string
  tone?: 'primary' | 'danger' | 'success'
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ open, title, description, children, confirmLabel, tone = 'primary', loading, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Modal
      open={open}
      onClose={loading ? () => {} : onCancel}
      size="sm"
      title={
        <span className="flex items-center gap-2">
          {tone === 'danger' && <AlertTriangle className="size-5 text-red-600" />}
          {title}
        </span>
      }
      description={description}
      footer={
        <>
          <Button onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  )
}

export function Drawer({ open, onClose, title, subtitle, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const titleId = useId()
  useEscape(open, onClose)
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 animate-fade-in bg-slate-900/30" onClick={onClose} aria-hidden />
      <aside role="dialog" aria-modal="true" aria-labelledby={titleId} className="relative flex h-full w-full max-w-xl animate-slide-in flex-col bg-white shadow-pop">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-base font-semibold text-slate-900">
              {title}
            </h2>
            {subtitle && <div className="mt-1 text-sm text-slate-500">{subtitle}</div>}
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-6 py-3.5">{footer}</div>}
      </aside>
    </div>,
    document.body,
  )
}
