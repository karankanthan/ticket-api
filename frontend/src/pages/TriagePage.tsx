import { useState, type FormEvent } from 'react'
import { BookOpen, Sparkles } from 'lucide-react'
import { ApiError, request } from '../api/client'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, CardBody, CardHeader } from '../components/ui/Card'
import { InlineAlert } from '../components/ui/Feedback'
import { Input, Label, Textarea } from '../components/ui/Form'

type TriageResult = {
  category: string
  priority: string
  suggested_reply: string
  source_article_ids: string[]
}

// The existing AI triage feature (POST /triage), unchanged in behaviour.
export default function TriagePage() {
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [result, setResult] = useState<TriageResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setResult(null)

    if (!subject.trim() && !message.trim()) {
      setError('Enter a ticket subject or message.')
      return
    }

    setLoading(true)
    try {
      setResult(await request<TriageResult>('/triage', { method: 'POST', body: { subject, text: message }, admin: false }))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to connect to the support API.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <p className="text-xs font-semibold tracking-wider text-brand-600 uppercase">Customer support · AI assistant</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Ticket Triage</h1>
        <p className="mt-1 text-sm text-slate-500">Classify support tickets and generate helpful replies grounded in the knowledge base.</p>
      </header>

      <Card>
        <CardHeader title="Submit a ticket" description="Enter the customer's subject and message to get a suggested response." icon={<Sparkles className="size-4" />} />
        <CardBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="subject">Ticket subject</Label>
              <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Unable to reset my password" maxLength={200} />
            </div>
            <div>
              <Label htmlFor="message">Customer message</Label>
              <Textarea id="message" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Describe the customer's issue..." rows={6} maxLength={5000} />
            </div>
            <Button type="submit" variant="primary" loading={loading}>
              {loading ? 'Analyzing ticket...' : 'Triage ticket'}
            </Button>
          </form>
          {loading && (
            <p className="mt-4 text-sm text-slate-500" role="status">
              Reviewing the ticket and relevant help articles...
            </p>
          )}
          {error && (
            <div className="mt-4">
              <InlineAlert tone="error">{error}</InlineAlert>
            </div>
          )}
        </CardBody>
      </Card>

      {result && (
        <Card className="mt-6">
          <CardHeader title="Triage result" />
          <CardBody className="space-y-5" >
            <div className="grid grid-cols-2 gap-4" aria-live="polite">
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-500 uppercase">Category</p>
                <p className="mt-1 font-semibold text-slate-900">{result.category}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-500 uppercase">Priority</p>
                <p className="mt-1 font-semibold text-slate-900">{result.priority}</p>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Suggested reply</h3>
              <p className="mt-2 rounded-lg border border-slate-200 bg-white p-4 text-sm whitespace-pre-wrap text-slate-700">{result.suggested_reply}</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Source articles</h3>
              {result.source_article_ids.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {result.source_article_ids.map((id) => (
                    <Badge key={id} className="bg-slate-50 text-slate-700 ring-slate-300">
                      <BookOpen className="size-3" /> {id}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-slate-500">No matching article was found. Human support follow-up is recommended.</p>
              )}
            </div>
            <p className="text-xs text-slate-500">Review the suggested reply before sending it to a customer.</p>
          </CardBody>
        </Card>
      )}
    </div>
  )
}
