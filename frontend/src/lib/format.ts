// Formatting helpers. Backend timestamps are ISO strings with an offset; ticket CSV
// dates are "YYYY-MM-DD HH:MM" in the server's local time.

export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const csv = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(value)
  if (csv) {
    const [, y, m, d, h, min] = csv.map(Number)
    return new Date(y, m - 1, d, h, min)
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

export function formatDateTime(value: string | null | undefined, fallback = '—'): string {
  const date = parseDate(value)
  return date ? dateTime.format(date) : fallback
}

export function formatDate(value: string | null | undefined, fallback = '—'): string {
  const date = parseDate(value)
  return date ? dateOnly.format(date) : fallback
}

export function timeAgo(value: string | Date | null | undefined, now: Date = new Date()): string {
  const date = value instanceof Date ? value : parseDate(value)
  if (!date) return '—'
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000)
  const future = seconds < 0
  const abs = Math.abs(seconds)
  const units: [number, string][] = [
    [60 * 60 * 24 * 365, 'year'],
    [60 * 60 * 24 * 30, 'month'],
    [60 * 60 * 24, 'day'],
    [60 * 60, 'hour'],
    [60, 'minute'],
  ]
  for (const [size, name] of units) {
    if (abs >= size) {
      const n = Math.floor(abs / size)
      const label = `${n} ${name}${n === 1 ? '' : 's'}`
      return future ? `in ${label}` : `${label} ago`
    }
  }
  return future ? 'in a moment' : 'just now'
}

/** 26.5 -> "1d 2h", 3.25 -> "3h 15m", 0.5 -> "30m" */
export function formatHours(hours: number | null | undefined, fallback = '—'): string {
  if (hours === null || hours === undefined || Number.isNaN(hours)) return fallback
  const totalMinutes = Math.round(Math.abs(hours) * 60)
  const days = Math.floor(totalMinutes / (60 * 24))
  const h = Math.floor((totalMinutes % (60 * 24)) / 60)
  const m = totalMinutes % 60
  if (days) return `${days}d ${h}h`
  if (h) return m ? `${h}h ${m}m` : `${h}h`
  return `${m}m`
}

export function ageHours(createdAt: string | null | undefined, now: Date = new Date()): number | null {
  const date = parseDate(createdAt)
  return date ? (now.getTime() - date.getTime()) / 3_600_000 : null
}

const currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' })

export function formatMoney(amount: number | null | undefined, fallback = '—'): string {
  return amount === null || amount === undefined ? fallback : currency.format(amount)
}

export function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : value.toLocaleString()
}

export function percent(part: number, total: number): string {
  if (!total) return '0%'
  return `${Math.round((part / total) * 100)}%`
}

export function titleCase(value: string | null | undefined): string {
  if (!value) return '—'
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}
