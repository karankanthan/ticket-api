import { useState, type ReactNode } from 'react'
import { CheckCircle2, Clock, Cog, KeyRound, Mail, Play, Send, Server, ShieldCheck, XCircle } from 'lucide-react'
import { API_BASE_URL, ApiError, getAdminKey, setAdminKey } from '../api/client'
import { api } from '../api/endpoints'
import type { AppSettings, TestEmailResult } from '../api/types'
import { DeliveryBadge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, CardBody, CardHeader } from '../components/ui/Card'
import { ConfirmDialog } from '../components/ui/Dialog'
import { ErrorState, InlineAlert, Skeleton } from '../components/ui/Feedback'
import { Input, Label } from '../components/ui/Form'
import { DefinitionList, PageHeader } from '../components/ui/Layout'
import { useToast } from '../components/ui/toastContext'
import { broadcastRefresh, useApi } from '../hooks/useApi'
import { cx, formatDateTime, formatHours, timeAgo } from '../lib/format'
import { PRIORITIES, priorityMeta } from '../lib/meta'
import { TD, TH } from '../lib/table'

function Status({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-sm font-medium', ok ? 'text-emerald-700' : 'text-red-700')}>
      {ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
      {children}
    </span>
  )
}

function AdminKeyCard({ required }: { required: boolean | undefined }) {
  const toast = useToast()
  const [value, setValue] = useState('')
  const [hasKey, setHasKey] = useState(() => !!getAdminKey())
  return (
    <Card>
      <div id="admin-key" />
      <CardHeader icon={<KeyRound className="size-4" />} title="Admin key for this browser" description="Needed only when the backend has ADMIN_API_KEY set. Kept for this browser tab session only and never stored in the app code." />
      <CardBody className="space-y-4">
        <p className="text-sm text-slate-600">
          Backend requires a key:{' '}
          <strong>{required === undefined ? 'unknown (settings not loaded)' : required ? 'yes' : 'no (local mode)'}</strong>
          {hasKey && ' · a key is set for this session'}
        </p>
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault()
            setAdminKey(value.trim())
            setHasKey(!!value.trim())
            setValue('')
            toast({ tone: 'success', title: 'Admin key saved for this session' })
            broadcastRefresh()
          }}
        >
          <div className="flex-1">
            <Label htmlFor="admin-key-input">Admin key</Label>
            <Input id="admin-key-input" type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Paste the key from your administrator" />
          </div>
          <Button type="submit" variant="primary" disabled={!value.trim()}>
            Use key
          </Button>
          {hasKey && (
            <Button
              onClick={() => {
                setAdminKey('')
                setHasKey(false)
                toast({ tone: 'info', title: 'Admin key removed' })
                broadcastRefresh()
              }}
            >
              Forget key
            </Button>
          )}
        </form>
        <p className="text-xs text-slate-500">This is one shared key, not a personal sign-in. Anyone with it has full Helpdesk Head access.</p>
      </CardBody>
    </Card>
  )
}

function EmailCard({ settings }: { settings: AppSettings }) {
  const toast = useToast()
  const email = settings.email
  const [confirm, setConfirm] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<TestEmailResult | null>(null)

  async function sendTest() {
    setSending(true)
    try {
      const r = await api.testEmail()
      setResult(r)
      toast({ tone: r.status === 'failed' ? 'error' : r.delivered ? 'success' : 'info', title: r.status === 'failed' ? 'Test email failed' : r.delivered ? 'Test email sent' : 'Test email not delivered (local mode)' })
      broadcastRefresh()
    } catch (err) {
      toast({ tone: 'error', title: 'Could not send a test email', description: err instanceof ApiError ? err.message : undefined })
    } finally {
      setSending(false)
      setConfirm(false)
    }
  }

  return (
    <Card>
      <CardHeader
        icon={<Mail className="size-4" />}
        title="Email"
        description="Configured in the backend .env file. Passwords are never sent to the browser."
        action={
          <Button size="sm" icon={<Send className="size-3.5" />} onClick={() => setConfirm(true)} disabled={!email.ready}>
            Send test email
          </Button>
        }
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Status ok={email.manager_email_configured}>{email.manager_email_configured ? 'Manager email set' : 'Manager email not set'}</Status>
          <Status ok={email.smtp_configured}>{email.smtp_configured ? 'SMTP configured' : email.backend === 'smtp' ? 'SMTP not fully configured' : 'SMTP not in use'}</Status>
          <Status ok={email.delivery.verified}>
            {email.delivery.verified ? `Real delivery verified ${timeAgo(email.delivery.last_success_at)}` : email.backend === 'smtp' ? 'Real delivery not verified yet' : 'Not delivering real email'}
          </Status>
        </div>
        {email.missing_settings.length > 0 && <InlineAlert tone="error">Missing settings: {email.missing_settings.join(', ')}</InlineAlert>}
        {email.delivery.last_error && (
          <InlineAlert tone="error" title={`Last delivery attempt failed (${formatDateTime(email.delivery.last_attempt_at)})`}>
            {email.delivery.last_error}
          </InlineAlert>
        )}
        {email.warnings.map((w) => (
          <InlineAlert key={w} tone="warning">
            {w}
          </InlineAlert>
        ))}
        <DefinitionList
          items={[
            { label: 'Backend', value: email.backend },
            { label: 'Manager email', value: email.manager_email || 'Not set' },
            { label: 'From address', value: email.email_from || 'Not set' },
            { label: 'SMTP server', value: email.backend === 'smtp' ? `${email.smtp_host || 'not set'}:${email.smtp_port ?? ''} (${email.smtp_security})` : 'Not used' },
            { label: 'SMTP login', value: email.backend === 'smtp' ? (email.smtp_auth_configured ? 'Username and password set' : 'Not set') : 'Not used' },
            { label: 'Outbox folder', value: email.outbox_dir ? <span className="font-mono text-xs break-all">{email.outbox_dir}</span> : 'Not used' },
            { label: 'Manager link address', value: <span className="font-mono text-xs">{email.public_base_url}</span> },
          ]}
        />
        {result && (
          <div className="rounded-lg border border-slate-200 p-3 text-sm">
            <div className="flex items-center gap-2">
              Last test: <DeliveryBadge status={result.status} /> <span className="text-slate-500">{timeAgo(result.at)}</span>
            </div>
            {result.error && <p className="mt-1 text-red-700">{result.error}</p>}
            {result.outbox_file && <p className="mt-1 font-mono text-xs break-all text-slate-500">{result.outbox_file}</p>}
          </div>
        )}
      </CardBody>
      <ConfirmDialog open={confirm} title="Send a test email?" confirmLabel="Send test" loading={sending} onCancel={() => setConfirm(false)} onConfirm={sendTest}>
        <p className="text-sm text-slate-600">
          {email.delivers_real_email ? `A short test message is sent to ${email.manager_email}.` : `The ${email.backend} backend does not deliver email; the message is ${email.backend === 'file' ? 'saved to the outbox' : 'printed in the backend console'}.`}
        </p>
      </ConfirmDialog>
    </Card>
  )
}

function AutomationCard({ settings }: { settings: AppSettings }) {
  const toast = useToast()
  const [running, setRunning] = useState(false)
  async function run() {
    setRunning(true)
    try {
      const r = await api.runAutomation()
      toast({
        tone: 'success',
        title: 'Automation checks finished',
        description: `${r.reminder_emails.length} reminder email(s), ${r.newly_overdue_requests.length} newly overdue, ${r.newly_breached_tickets.length} newly breached.`,
      })
      broadcastRefresh()
    } catch (err) {
      toast({ tone: 'error', title: 'Automation run failed', description: err instanceof ApiError ? err.message : undefined })
    } finally {
      setRunning(false)
    }
  }
  return (
    <Card>
      <CardHeader
        icon={<Clock className="size-4" />}
        title="Reminders and automation"
        description="Pending requests get reminders; overdue requests are reported, never decided automatically."
        action={
          <Button size="sm" icon={<Play className="size-3.5" />} onClick={run} loading={running}>
            Run checks now
          </Button>
        }
      />
      <CardBody>
        <DefinitionList
          items={[
            { label: 'Scheduler', value: settings.environment.scheduler_enabled ? `On, every ${formatHours(settings.environment.scheduler_interval_seconds / 3600)}` : 'Off' },
            { label: 'Reminders after', value: settings.reminders.after_hours.map((h) => formatHours(h)).join(', ') },
            { label: 'Maximum reminders', value: `${settings.reminders.max_reminders} per request` },
            { label: 'Action links expire after', value: formatHours(settings.reminders.action_link_ttl_hours) },
            { label: 'Largest batch', value: `${settings.batches.max_batch_size} tickets` },
          ]}
        />
      </CardBody>
    </Card>
  )
}

export default function SettingsPage() {
  const settings = useApi((signal) => api.settings(signal), [])
  const health = useApi((signal) => api.health(signal), [], { pollMs: 30_000 })
  const s = settings.data

  return (
    <>
      <PageHeader title="Settings" description="Read-only view of the backend configuration. Change values in the backend .env file and restart the API." />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {settings.error && !s ? (
          <Card className="xl:col-span-2">
            <ErrorState error={settings.error} onRetry={settings.reload} />
          </Card>
        ) : !s ? (
          <>
            <Skeleton className="h-72" />
            <Skeleton className="h-72" />
          </>
        ) : (
          <>
            <EmailCard settings={s} />
            <Card>
              <CardHeader icon={<ShieldCheck className="size-4" />} title="SLA targets" description="Ticket SLA and manager response targets are measured separately." />
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100">
                  <thead className="bg-slate-50/70">
                    <tr>
                      <th className={TH}>Priority</th>
                      <th className={TH}>Ticket SLA</th>
                      <th className={TH}>Manager response</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {PRIORITIES.map((p) => (
                      <tr key={p}>
                        <td className={TD}>{priorityMeta(p).label}</td>
                        <td className={cx(TD, 'tabular')}>{formatHours(s.sla.ticket_sla_hours[p])}</td>
                        <td className={cx(TD, 'tabular')}>{formatHours(s.sla.approval_response_hours[p])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="px-5 py-3 text-xs text-slate-500">A ticket is “at risk” when {Math.round(s.sla.at_risk_fraction * 100)}% or less of its SLA time remains.</p>
            </Card>
            <Card>
              <CardHeader icon={<Cog className="size-4" />} title="Approval rules" description="A ticket needs manager approval if any rule matches." />
              <ul className="divide-y divide-slate-100">
                {s.approval_rules.map((r) => (
                  <li key={r.rule} className="px-5 py-3">
                    <p className="text-sm font-medium text-slate-900 first-letter:uppercase">{r.rule}</p>
                    <p className="text-sm text-slate-500">{r.description}</p>
                  </li>
                ))}
              </ul>
            </Card>
            <AutomationCard settings={s} />
            {s.employee_notifications && (
              <Card>
                <CardHeader icon={<Mail className="size-4" />} title="Employee notifications" description="After each manager decision, the employee who raised the ticket is emailed. Customers are never emailed." />
                <CardBody>
                  <DefinitionList
                    items={[
                      { label: 'Status', value: s.employee_notifications.enabled ? 'On' : 'Off (EMPLOYEE_NOTIFICATIONS=false)' },
                      { label: 'Allowed domains', value: s.employee_notifications.allowed_domains.length ? s.employee_notifications.allowed_domains.join(', ') : 'Any valid address in the employee column' },
                      { label: 'Address source', value: s.employee_notifications.source },
                    ]}
                  />
                </CardBody>
              </Card>
            )}
            <Card>
              <CardHeader icon={<Server className="size-4" />} title="Environment" />
              <CardBody>
                <DefinitionList
                  items={[
                    { label: 'Mode', value: s.environment.app_env },
                    { label: 'Admin key required', value: s.environment.admin_key_required ? 'Yes' : 'No' },
                    { label: 'Tickets loaded', value: s.environment.tickets_loaded },
                    { label: 'Ticket data file', value: <span className="font-mono text-xs break-all">{s.environment.ticket_data_file}</span> },
                    { label: 'Data folder', value: <span className="font-mono text-xs break-all">{s.environment.store_dir}</span> },
                    { label: 'Storage', value: 'JSON files (no database)' },
                  ]}
                />
              </CardBody>
            </Card>
          </>
        )}
        <Card>
          <CardHeader icon={<Server className="size-4" />} title="API connection" />
          <CardBody>
            <DefinitionList
              items={[
                { label: 'API address', value: <span className="font-mono text-xs">{API_BASE_URL || `${window.location.origin} (development proxy)`}</span> },
                {
                  label: 'Backend status',
                  value: health.error ? <Status ok={false}>{health.error.message}</Status> : health.data ? <Status ok>Connected</Status> : 'Checking…',
                },
                { label: 'Storage writable', value: health.data ? (health.data.store_dir_writable ? 'Yes' : 'No') : '—' },
                { label: 'Last automation run', value: health.data?.scheduler_last_run_at ? formatDateTime(health.data.scheduler_last_run_at) : 'Not yet' },
              ]}
            />
          </CardBody>
        </Card>
        <AdminKeyCard required={s?.environment.admin_key_required} />
      </div>
    </>
  )
}
