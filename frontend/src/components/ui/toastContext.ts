import { createContext, useContext } from 'react'

export type ToastTone = 'success' | 'error' | 'info' | 'warning'

export interface ToastInput {
  tone?: ToastTone
  title: string
  description?: string
}

export const ToastContext = createContext<(toast: ToastInput) => void>(() => {})

export function useToast() {
  return useContext(ToastContext)
}
