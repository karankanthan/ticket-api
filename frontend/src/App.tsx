
import { useState, type FormEvent } from 'react'
import './App.css'

type TriageResult = {
  category: string
  priority: string
  suggested_reply: string
  source_article_ids: string[]
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL

function App() {
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
      const response = await fetch(`${API_BASE_URL}/triage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, text: message }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(
          typeof data.detail === 'string'
            ? data.detail
            : 'Unable to triage this ticket. Please try again.',
        )
      }

      setResult(data as TriageResult)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to connect to the support API.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="app">
      <header className="page-header">
        <p className="eyebrow">CUSTOMER SUPPORT · AI ASSISTANT</p>
        <h1>Ticket Triage</h1>
        <p className="subtitle">
          Classify support tickets and generate helpful replies grounded in
          the knowledge base.
        </p>
      </header>

      <section className="panel">
        <h2>Submit a ticket</h2>
        <p className="muted">
          Enter the customer's subject and message to get a suggested response.
        </p>

        <form onSubmit={handleSubmit}>
          <label htmlFor="subject">Ticket subject</label>
          <input
            id="subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="e.g. Unable to reset my password"
            maxLength={200}
          />

          <label htmlFor="message">Customer message</label>
          <textarea
            id="message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Describe the customer's issue..."
            rows={6}
            maxLength={5000}
          />

          <button type="submit" disabled={loading}>
            {loading ? 'Analyzing ticket...' : 'Triage ticket'}
          </button>
        </form>

        {loading && (
          <p className="status" role="status">
            Reviewing the ticket and relevant help articles...
          </p>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>

      {result && (
        <section className="panel results" aria-live="polite">
          <h2>Triage result</h2>

          <div className="result-grid">
            <div className="result-item">
              <span className="result-label">Category</span>
              <strong>{result.category}</strong>
            </div>
            <div className="result-item">
              <span className="result-label">Priority</span>
              <strong className={`priority ${result.priority.toLowerCase()}`}>
                {result.priority}
              </strong>
            </div>
          </div>

          <h3>Suggested reply</h3>
          <p className="reply">{result.suggested_reply}</p>

          <h3>Source articles</h3>
          {result.source_article_ids.length > 0 ? (
            <ul className="sources">
              {result.source_article_ids.map((id) => (
                <li key={id}>{id}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              No matching article was found. Human support follow-up is
              recommended.
            </p>
          )}
          <p className="muted disclaimer">
            Review the suggested reply before sending it to a customer.
          </p>
        </section>
      )}
    </main>
  )
}

export default App
