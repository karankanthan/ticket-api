import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { Search } from 'lucide-react'
import { cx } from '../../lib/format'

const CONTROL =
  'block w-full rounded-lg border-0 bg-white text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-500 disabled:bg-slate-50 disabled:text-slate-500'

export function Label({ htmlFor, children, hint }: { htmlFor?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-slate-700">
      {children}
      {hint && <span className="font-normal text-slate-400"> {hint}</span>}
    </label>
  )
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(CONTROL, 'h-9 px-3', className)} {...rest} />
}

export function SearchInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cx('relative', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
      <input type="search" className={cx(CONTROL, 'h-9 pr-3 pl-9')} {...rest} />
    </div>
  )
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(CONTROL, 'h-9 py-0 pr-8 pl-3', className)} {...rest}>
      {children}
    </select>
  )
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(CONTROL, 'px-3 py-2', className)} {...rest} />
}

export function Checkbox({ label, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode }) {
  const box = <input type="checkbox" className={cx('size-4 rounded border-slate-300 text-brand-600 accent-brand-600 focus:ring-brand-500', className)} {...rest} />
  if (!label) return box
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
      {box}
      {label}
    </label>
  )
}
