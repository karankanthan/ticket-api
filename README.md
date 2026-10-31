# ticket-api

A small FastAPI service for support tickets: ticket lookup, a per-category summary, AI ticket triage (Task 4), and a billing approval and escalation prototype (Task 5).

It also includes **TicketFlow**, a React web app for the Helpdesk Head (dashboard, tickets, CSV import, Approval Control Center, history, reports and settings) and a no-login page where the manager approves, rejects or asks for more information from email links.

AI Triage (Task 4) is kept as a **standalone backend capability** (`POST /triage`). It is not part of Mara's TicketFlow workflow and is not shown in the TicketFlow web app: tickets arrive from the existing helpdesk by CSV import, and triage only returns suggestions, it never creates or changes tickets.

## Quick start: TicketFlow on Windows

From the project folder in PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process Bypass   # only if scripts are blocked
.\scripts\dev.ps1
```

This opens two windows: the API on http://localhost:8000 and the web app on **http://localhost:5173**. To start them separately, run `.\scripts\start-backend.ps1` and `.\scripts\start-frontend.ps1` in two windows. The first run creates `.venv` and installs the npm packages (Python 3.10+ and Node.js 20+ are needed).

The start script sets `PUBLIC_BASE_URL=http://localhost:5173`, so the links in manager emails open the TicketFlow decision page. Without the web app, set `PUBLIC_BASE_URL=http://localhost:8000` to use the API's built-in confirmation page instead.

Frontend details are in [frontend/README.md](frontend/README.md).

## Requirements

- Python 3.10 or newer
- Git

## Run from scratch

### 1. Get the code

```bash
git clone https://github.com/karankanthan/ticket-api.git
cd ticket-api
```

### 2. Create and activate a virtual environment

**Windows (PowerShell):**

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
```

If PowerShell blocks the activation script, run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
```

Then try activating the environment again.

**macOS or Linux:**

```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 3. Install dependencies

```bash
python -m pip install -r requirements-dev.txt
```

### 4. Start the API

```bash
python -m uvicorn app.main:app --reload
```

### 5. Check that it works

- Health check: http://localhost:8000/health — should return `{"status": "ok"}`
- API documentation: http://localhost:8000/docs
- Web page: http://localhost:8000/

The app reads `data/tickets_sample.csv` by default. To use a different file, set `TICKETS_DATA_PATH` before starting the app.

Only `POST /triage` needs a Groq API key (see Task 4 below). Other features work without it.

## Test

```bash
python -m pytest -q
```

The tests do not need a Groq API key or an internet connection.

Frontend tests, lint and build:

```powershell
cd frontend
npm test
npm run lint
npm run build
```



## Task 4: AI-Powered Ticket Triage

This feature classifies customer support tickets, assigns a priority, and generates a suggested reply using the Groq API and the provided knowledge base.

**Status:** retained as a standalone backend capability. It is not part of Mara's TicketFlow workflow, which works on tickets imported from the existing helpdesk:

- `POST /triage` and its tests are unchanged, and the Render deployment below still serves it.
- It only returns suggestions. It never creates tickets or changes the approval queue or approval records (`tests/test_triage_guard.py` checks this).
- It is not in the TicketFlow sidebar or routes, and the TicketFlow dev server does not forward `/triage`. The page component (`frontend/src/pages/TriagePage.tsx`) and its test are kept in the source but not routed.
- Text sent to `/triage` is passed to an external AI service (Groq), so avoid pasting customer personal data.

### Features

- Classifies tickets into categories such as Login, Billing, Shipping, Refunds, Technical, and Account.
- Assigns a priority: urgent, high, normal, or low.
- Generates a suggested reply grounded in relevant knowledge-base articles.
- Returns the source article IDs used to generate the response.
- Recommends human support follow-up when the available knowledge base does not support an answer.
- Includes input validation and handles AI service failures.

### Run the Backend

Install the dependencies:

```powershell
python -m pip install -r requirements.txt
```

Set the ticket data path and start the API:

```powershell
$env:TICKETS_DATA_PATH = "data/tickets_sample.csv"
python -m uvicorn app.main:app --reload
```

### Configure the Groq API Key

Create a `.env` file in the project root:

```dotenv
GROQ_API_KEY=your_groq_api_key_here
```

Replace the placeholder with your own Groq API key. Never commit the real key to GitHub.

For deployment, configure `GROQ_API_KEY` in the hosting platform's environment variables.

### Triage API

**Endpoint:** `POST /triage`

Example request:

```json
{
  "subject": "Password reset email not received",
  "text": "I requested a password reset 15 minutes ago, but I haven't received the email. Please help."
}
```

The response includes `category`, `priority`, `suggested_reply`, and `source_article_ids`.

### Using triage

Triage is no longer available from the TicketFlow web app. Call the API directly instead: open http://localhost:8000/docs, choose `POST /triage` and use "Try it out", or use the deployed API below.

To show the triage page again, route `TriagePage` in `frontend/src/App.tsx` and add `/triage` back to `PROXIED_PATHS` in `frontend/vite.config.ts`. A production build uses `VITE_API_BASE_URL` from `frontend/.env` (the Task 4 deployment); the dev server always uses the local backend.

### Frontend Tests and Production Build

Run the frontend tests:

```powershell
npm run test
```

Create a production build:

```powershell
npm run build
```

Run backend tests from the project root:

```powershell
python -m pytest -q
```

### Deployment

The backend is deployed on Render:

- API base URL: https://ticket-triage-api-f7n2.onrender.com
- Interactive API documentation: https://ticket-triage-api-f7n2.onrender.com/docs

The free hosting instance may take additional time to respond after a period of inactivity.

### Knowledge Base

The `kb/` directory contains the help articles used for ticket triage. The retrieval component selects relevant articles, vand the AI service uses those articles as context when generating a suggested reply.

Suggested replies should be reviewed by a human before being sent to customers.


## Task 5: Billing Approval and Escalation Prototype

This prototype creates approval requests for support tickets, identifies escalations, and allows managers to approve, reject, or request more information.

### Escalation Rules

A request is escalated if any one of these conditions is met:

- The ticket priority is `urgent`.
- The refund amount is more than $200.
- A team account is closing.

These rules need confirmation from Mara.

### API Endpoints

- `POST /approval-requests` — Create an approval request.
- `GET /approval-requests` — List all approval requests.
- `GET /approval-requests/{request_id}` — Get one approval request.
- `POST /approval-requests/{request_id}/actions` — Approve, reject, or request more information.

### Example Request

```json
{
  "ticket_id": "TCK-1003",
  "refund_amount": 250,
  "team_account_closing": false
}
```

### Example Action

```json
{
  "action": "need_more_info",
  "note": "Add invoice number"
}
```

### Approval Rules

Each request copies the ticket's details (category, priority, status, created and resolved dates) from the ticket data, so they don't need to be entered by hand.

New requests start with `pending` status. The `need_more_info` action requires a note and allows the manager to approve or reject the request later. Once a request is approved or rejected, its decision cannot be changed.

### Limitations

Approval requests are now saved to `data/store/` and survive restarts (see the Approval Control Center below). Help desk integrations are not included. The escalation rules and approval workflow still need confirmation from Mara.

These endpoints are unchanged and are not protected by `ADMIN_API_KEY`, so anyone who can reach the API can record a decision through them. Keep this in mind before deploying.

## Approval Control Center (backend)

The Helpdesk Head reviews tickets that need manager approval, picks some (Top 5, 10, 20, a custom number, or individual tickets), and sends the manager **one email per batch**. The email has separate Approve, Reject and Request more information links for each ticket. The manager does not sign in.

### How it works

1. **Detection.** When the app starts, or when `POST /api/control-center/import` re-reads the CSV, unresolved tickets (`open`, `in_progress`) are checked against the escalation rules:
   - priority `urgent`
   - `refund_amount` over $200, when the column is present
   - a `team_account_closing` column set to `yes`/`true`/`1`. A `team-account` label alone does **not** count.

   Matching tickets go into the **queue** as recommendations. Nothing is emailed and no approval request is created yet. Tickets that already have a request, or that were dismissed, are not recommended again.
2. **Manual requests.** Any ticket, even a resolved one, can be added with `POST /api/control-center/queue`.
3. **Ranking.** Urgent first, then SLA breached, then least time left before breach, then oldest, then larger refund.
4. **Preview, then submit.** `POST /api/control-center/preview` returns the selection. `POST /api/control-center/batches` with those `item_ids` creates the approval requests and sends one email. A ticket with an open request cannot be sent again.
5. **Manager decision.** Each link opens a confirmation page, and **opening a link changes nothing**, because email scanners open links automatically. The decision is saved only when the manager presses Confirm. Links are single-use and expire (72 h by default). Once one is used, the other links for that ticket stop working. Only SHA-256 hashes of the links are stored.
6. **More information.** If the manager asks for more information, answer with `POST /api/approvals/{id}/provide-info`. The ticket goes back into the queue to be sent again.
7. **Automation**, every 5 minutes by default:
   - Reminders at 2, 6 and 24 hours, at most 3 per request. Each reminder is one email per batch, with fresh links that replace the old ones.
   - Overdue manager responses (4 h for urgent, 24 h otherwise) and newly breached ticket SLAs are recorded in the activity history.

   Nothing is ever approved or rejected automatically.

Ticket SLA targets are 4 / 8 / 24 / 72 hours (urgent / high / normal / low). They are measured from `created_at` and only when the needed dates exist. A resolved ticket without `resolved_at` shows SLA as `unknown`; no dates are guessed. CSV times are read as this computer's local time.

All timings are configurable; see `.env.example`.

### New endpoints

All `/api/...` routes need the `X-Admin-Key` header when `ADMIN_API_KEY` is set.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Detailed health: tickets loaded, storage writable, email and scheduler status |
| GET | `/api/dashboard` | Ticket, SLA, approval, queue, batch and email statistics |
| GET | `/api/control-center/queue?priority=urgent,high` | Ranked recommendation queue |
| POST | `/api/control-center/queue` | Add any ticket manually |
| POST | `/api/control-center/queue/{item_id}/dismiss` | Remove a recommendation |
| POST | `/api/control-center/preview` | Preview Top N (`mode: top`, `count`, `priorities`) or a manual selection (`mode: manual`, `item_ids`) |
| POST | `/api/control-center/batches` | Submit the reviewed `item_ids` and email the manager |
| GET | `/api/control-center/batches` | Batch history |
| GET | `/api/control-center/batches/{batch_id}` | One batch with its requests and email attempts |
| POST | `/api/control-center/batches/{batch_id}/resend` | Send fresh links for the batch's pending requests (after a failed email or expired links) |
| POST | `/api/control-center/import` | Re-read the ticket CSV and analyse it |
| GET | `/api/approvals?status=&batch_id=&ticket_id=` | Approval history |
| GET | `/api/approvals/{request_id}` | One request with its full history |
| POST | `/api/approvals/{request_id}/provide-info` | Answer the manager's request for more information |
| GET | `/api/activity?limit=&event=` | Activity history |
| GET | `/api/email/status` | Email configuration (manager address masked, no passwords) |
| POST | `/api/email/test` | Send a test email (`{"confirm": true}`) |
| GET | `/api/automation/status` | Scheduler status and reminders due |
| POST | `/api/automation/run` | Run the reminder and SLA checks now |
| GET | `/api/tickets/{ticket_id}/sla` | SLA for one ticket |
| GET / POST | `/act/{token}` | Manager confirmation page (GET) and decision (POST). No admin key. |
| GET / POST | `/api/manager/actions/{token}` | The same as JSON, used by the TicketFlow manager page. No admin key. |
| GET | `/api/tickets`, `/api/tickets/{ticket_id}` | All tickets with SLA and approval status (no customer contact data) |
| POST | `/api/imports/preview` | Check an uploaded CSV: detected columns, suggested mapping, row errors |
| POST | `/api/imports` | Import a CSV with a column mapping; current tickets are kept if it fails |
| GET | `/api/imports` | Import history and the active ticket file |
| GET | `/api/settings` | Configuration summary without secrets |

### Try the manager workflow locally

With the default `EMAIL_BACKEND=file`, nothing is emailed. Each message is saved as an `.eml` file in `data/outbox/`.

1. Start the API: `python -m uvicorn app.main:app --reload`
2. Open http://localhost:8000/docs.
3. Run `POST /api/control-center/preview` with `{"mode": "top", "count": 5}` and copy `item_ids` from the response.
4. Run `POST /api/control-center/batches` with `{"item_ids": [...]}`. The response says `"status": "saved_to_outbox"` and `"delivered": false`.
5. Open the newest file in `data/outbox/` (double-click opens it in Outlook or Mail, or open it in a text editor). Open an Approve, Reject or Request more information link in your browser and press Confirm.
6. Check `GET /api/approvals` and `GET /api/dashboard`: the decision shows straight away.

Because the sample CSV dates are from March 2026, every open sample ticket already shows as SLA breached.

### Real email (SMTP)

Set these in `.env`, then restart:

- `EMAIL_BACKEND=smtp`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`
- `SMTP_USERNAME`, `SMTP_PASSWORD`
- `EMAIL_FROM`, `MANAGER_EMAIL`

Then run `POST /api/email/test` with `{"confirm": true}`. Delivery is reported as `sent` only when the SMTP server accepted the message. Gmail and Microsoft 365 usually need an app password.

### Security and limitations

- **The admin key is a single shared key, not employee sign-in.** It is optional locally and required when `APP_ENV=production`. Anyone with the key has full Helpdesk Head access, and the history cannot show which person acted. Never put the key in frontend code or Git.
- **Anyone holding the email can act on it.** The manager's links work for anyone who has them. Decisions are recorded as "via email", not as a verified person.
- **Links to `localhost` only work on this computer.** Until the app is deployed, or reachable through a tunnel with `PUBLIC_BASE_URL` set, the manager cannot use links from another device.
- **One server process only.** Data is stored in JSON files with safe writes, and one server process must own them: no `--workers`, no second copy of the app.
- **Replies are not read.** Replies to the email are ignored; only the links record decisions.
