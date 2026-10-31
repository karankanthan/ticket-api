import { useState } from 'react'
import { ApiError } from '../api/client'
import { api } from '../api/endpoints'
import type { Ticket } from '../api/types'
import { broadcastRefresh } from '../hooks/useApi'
import { formatMoney } from '../lib/format'
import { PriorityBadge } from './ui/Badge'
import { Button } from './ui/Button'
import { Modal } from './ui/Dialog'
import { InlineAlert } from './ui/Feedback'
import { Checkbox, Input, Label, Textarea } from './ui/Form'
import { useToast } from './ui/toastContext'

/** Manual approval request for any ticket: adds it to the Approval Control Center queue. */
export function RequestApprovalDialog({ ticket, open, onClose, onDone }: { ticket: Ticket; open: boolean; onClose: () => void; onDone?: () => void }) {
  const toast = useToast()
  const [refund, setRefund] = useState(ticket.refund_amount !== null ? String(ticket.refund_amount) : '')
  const [closing, setClosing] = useState(ticket.team_account_closing)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    setError('')
    const amount = refund.trim() === '' ? null : Number(refund)
    if (amount !== null && (Number.isNaN(amount) || amount < 0)) {
      setError('Refund amount must be a positive number.')
      return
    }
    setSaving(true)
    try {
      await api.addToQueue({ ticket_id: ticket.ticket_id, refund_amount: amount, team_account_closing: closing, note: note.trim() || null })
      toast({ tone: 'success', title: `${ticket.ticket_id} added to the approval queue`, description: 'Send it to the manager from the Control Center.' })
      broadcastRefresh()
      onDone?.()
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the ticket to the queue.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title={`Request approval for ${ticket.ticket_id}`}
      description="Adds this ticket to the Approval Control Center queue. Nothing is emailed until you send a batch."
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={saving}>
            Add to approval queue
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <PriorityBadge priority={ticket.priority} />
          <span>{ticket.category || 'Uncategorised'}</span>
          {ticket.refund_amount !== null && <span>· Refund in data: {formatMoney(ticket.refund_amount)}</span>}
        </div>
        <div>
          <Label htmlFor="refund" hint="(optional)">
            Refund amount (USD)
          </Label>
          <Input id="refund" inputMode="decimal" value={refund} onChange={(e) => setRefund(e.target.value)} placeholder="e.g. 250" />
        </div>
        <Checkbox label="This is a team account closing request" checked={closing} onChange={(e) => setClosing(e.target.checked)} />
        <div>
          <Label htmlFor="note" hint="(optional, shown in history)">
            Reason for the request
          </Label>
          <Textarea id="note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && <InlineAlert tone="error">{error}</InlineAlert>}
      </div>
    </Modal>
  )
}
