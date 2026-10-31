import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { Activity, CheckCircle2, Clock, HelpCircle, Link2Off, ShieldCheck, ThumbsDown, ThumbsUp, XCircle } from 'lucide-react'
import { ApiError } from '../api/client'
import { api } from '../api/endpoints'
import type { ManagerAction, ManagerOutcome } from '../api/types'
import { ApprovalBadge, Badge, PriorityBadge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { InlineAlert, Skeleton } from '../components/ui/Feedback'
import { Label, Textarea } from '../components/ui/Form'
import { broadcastRefresh } from '../hooks/useApi'
import { cx, formatDateTime, formatMoney, titleCase } from '../lib/format'
import { reasonLabel } from '../lib/meta'

const ACTIONS: Record<ManagerAction, { title: string; verb: string; button: string; variant: 'success' | 'danger' | 'primary'; icon: typeof ThumbsUp; accent: string }> = {
  approve: { title: 'Approve request', verb: 'approve this request', button: 'Confirm approval', variant: 'success', icon: ThumbsUp, accent: 'bg-emerald-50 text-emerald-700' },
  reject: { title: 'Reject request', verb: 'reject this request', button: 'Confirm rejection', variant: 'danger', icon: ThumbsDown, accent: 'bg-red-50 text-red-700' },
  need_more_info: { title: 'Request more information', verb: 'ask the helpdesk for more information', button: 'Send request for information', variant: 'primary', icon: HelpCircle, accent: 'bg-brand-50 text-brand-700' },
}

const DONE: Record<ManagerAction, string> = {
  approve: 'Request approved',
  reject: 'Request rejected',
  need_more_info: 'Request for information sent',
}

const PROBLEMS: Record<string, { title: string; icon: typeof Clock; tone: string; help: string }> = {
  expired: { title: 'This link has expired', icon: Clock, tone: 'bg-amber-50 text-amber-600', help: 'Ask the helpdesk to resend the request if a decision is still needed.' },
  used: { title: 'This link has already been used', icon: CheckCircle2, tone: 'bg-slate-100 text-slate-600', help: 'Each link works once. Your earlier decision is recorded.' },
  revoked: { title: 'This link is no longer active', icon: Link2Off, tone: 'bg-slate-100 text-slate-600', help: 'A newer email replaced it, or another link for this request was used.' },
  decided: { title: 'This request was already decided', icon: CheckCircle2, tone: 'bg-slate-100 text-slate-600', help: 'No further action is needed.' },
  invalid: { title: 'This link is not valid', icon: XCircle, tone: 'bg-red-50 text-red-600', help: 'Check that the whole link was copied from the email.' },
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-2 px-4">
          <div className="flex size-7 items-center justify-center rounded-md bg-gradient-to-br from-brand-400 to-brand-700">
            <Activity className="size-4 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-semibold tracking-tight">TicketFlow</span>
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-slate-500">
            <ShieldCheck className="size-3.5" /> Secure approval link
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-8">{children}</main>
    </div>
  )
}

function Summary({ outcome }: { outcome: ManagerOutcome }) {
  const r = outcome.request
  if (!r) return null
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-mono text-lg font-semibold text-slate-900">{r.ticket_id}</p>
          <p className="text-xs text-slate-500">Request {r.request_id}</p>
        </div>
        <div className="flex gap-2">
          <PriorityBadge priority={r.priority} />
          <ApprovalBadge status={r.status} />
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-slate-500">Category</dt>
          <dd className="font-medium">{r.category || 'Uncategorised'}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Refund amount</dt>
          <dd className="font-medium">{formatMoney(r.refund_amount, 'Not provided')}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Ticket status</dt>
          <dd className="font-medium">{titleCase(r.ticket_status)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Ticket opened</dt>
          <dd className="font-medium">{formatDateTime(r.ticket_created_at)}</dd>
        </div>
      </dl>
      <div className="mt-4">
        <p className="text-xs text-slate-500">Why approval is needed</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {r.reasons.length ? (
            r.reasons.map((reason) => (
              <Badge key={reason} className="bg-slate-50 text-slate-700 ring-slate-300">
                {reasonLabel(reason)}
              </Badge>
            ))
          ) : (
            <span className="text-sm">Manual request from the helpdesk</span>
          )}
        </div>
      </div>
      {r.notes.length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <p className="mb-2 text-xs text-slate-500">Notes so far</p>
          <ul className="space-y-2">
            {r.notes.map((n, i) => (
              <li key={i} className="rounded-md bg-slate-50 px-3 py-2 text-sm">
                <span className="text-xs text-slate-500">
                  {titleCase(n.event)} · {formatDateTime(n.at)}
                </span>
                <p className="text-slate-700">{n.note}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * Opened from the manager's email. Loading the page never records anything:
 * the decision is only sent after the manager confirms it.
 */
export default function ManagerActionPage() {
  const { token = '' } = useParams()
  const [outcome, setOutcome] = useState<ManagerOutcome | null>(null)
  const [loadError, setLoadError] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    api
      .managerInspect(token, controller.signal)
      .then(setOutcome)
      .catch((err: unknown) => {
        if ((err as Error)?.name === 'AbortError') return
        if (err instanceof ApiError && err.detail && typeof err.detail === 'object' && 'state' in err.detail) setOutcome(err.detail as ManagerOutcome)
        else setLoadError(err instanceof ApiError ? err.message : 'This page could not be loaded.')
      })
    return () => controller.abort()
  }, [token])

  // The button is the confirmation, so a fast double-click must still send only one decision.
  const inFlight = useRef(false)

  async function submit() {
    if (inFlight.current) return
    inFlight.current = true
    setSubmitting(true)
    setFormError('')
    try {
      const result = await api.managerDecide(token, note.trim())
      setOutcome(result)
      if (result.state === 'done') broadcastRefresh()
    } catch (err) {
      const body = err instanceof ApiError ? (err.detail as ManagerOutcome | undefined) : undefined
      if (body && typeof body === 'object' && 'state' in body) {
        if (body.state === 'invalid_note' || body.state === 'needs_confirmation') setFormError(body.message)
        else setOutcome(body)
      } else {
        setFormError(err instanceof ApiError ? err.message : 'Your decision could not be sent. Please try again.')
      }
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }

  if (loadError) {
    return (
      <Shell>
        <InlineAlert tone="error" title="Something went wrong">
          {loadError}
        </InlineAlert>
      </Shell>
    )
  }
  if (!outcome) {
    return (
      <Shell>
        <div className="space-y-4" role="status" aria-label="Loading request">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-48 w-full" />
        </div>
      </Shell>
    )
  }

  if (outcome.state === 'done' && outcome.action) {
    return (
      <Shell>
        <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
          <CheckCircle2 className="mx-auto size-10 text-emerald-600" />
          <h1 className="mt-3 text-xl font-semibold text-slate-900">{DONE[outcome.action]}</h1>
          <p className="mt-1 text-sm text-slate-600">Your decision has been recorded and the helpdesk dashboard is updated. You can close this page.</p>
        </div>
        <Summary outcome={outcome} />
      </Shell>
    )
  }

  if (outcome.state !== 'ready' || !outcome.action) {
    const problem = PROBLEMS[outcome.state] ?? PROBLEMS.invalid
    return (
      <Shell>
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-6 text-center">
          <div className={cx('mx-auto w-fit rounded-full p-3', problem.tone)}>
            <problem.icon className="size-7" />
          </div>
          <h1 className="mt-3 text-xl font-semibold text-slate-900">{problem.title}</h1>
          <p className="mt-1 text-sm text-slate-600">{problem.help}</p>
        </div>
        <Summary outcome={outcome} />
      </Shell>
    )
  }

  const action = ACTIONS[outcome.action]
  const noteRequired = outcome.note_required
  return (
    <Shell>
      <div className="mb-6 flex items-center gap-3">
        <div className={cx('rounded-xl p-3', action.accent)}>
          <action.icon className="size-6" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{action.title}</h1>
          <p className="text-sm text-slate-500">Review the request, add a comment if you like, then press the button once. Opening this page records nothing.</p>
        </div>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <p className="mb-3 text-sm text-slate-700">
          Ticket <strong className="font-mono">{outcome.request?.ticket_id}</strong>
          {outcome.request?.refund_amount != null && <> · refund {formatMoney(outcome.request.refund_amount)}</>}
          {outcome.request?.reasons.length ? <> · {outcome.request.reasons.map(reasonLabel).join(', ')}</> : null}
        </p>
        <Label htmlFor="manager-note" hint={noteRequired ? '(required)' : '(optional)'}>
          {noteRequired ? 'What information do you need?' : 'Comment'}
        </Label>
        <Textarea id="manager-note" rows={4} maxLength={outcome.note_max_length} value={note} onChange={(e) => setNote(e.target.value)} />
        <p className="mt-1 text-right text-xs text-slate-400">
          {note.length}/{outcome.note_max_length}
        </p>
        {formError && (
          <div className="mt-3">
            <InlineAlert tone="error">{formError}</InlineAlert>
          </div>
        )}
        <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">{outcome.expires_at ? `This link expires ${formatDateTime(outcome.expires_at)}.` : null} To choose a different decision, use the other button in the email.</p>
          <Button className="w-full sm:w-auto" variant={action.variant} size="lg" icon={<action.icon className="size-4" />} loading={submitting} disabled={noteRequired && !note.trim()} onClick={submit}>
            {action.button}
          </Button>
        </div>
      </div>
      <h2 className="mt-8 mb-3 text-sm font-semibold text-slate-700">Ticket details</h2>
      <Summary outcome={outcome} />
    </Shell>
  )
}
