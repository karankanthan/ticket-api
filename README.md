# ticket-api

A small FastAPI service for support tickets: ticket lookup, a per-category summary, AI ticket triage (Task 4), and a billing approval and escalation prototype (Task 5).

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



## Task 4: AI-Powered Ticket Triage

This feature classifies customer support tickets, assigns a priority, and generates a suggested reply using the Groq API and the provided knowledge base.

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

### Run the Frontend

Open a separate terminal:

```powershell
cd frontend
npm install
npm run dev
```

Configure `frontend/.env` with the backend URL:

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:8000
```

For local development, start the backend before using the frontend. For a deployed frontend, set `VITE_API_BASE_URL` to the deployed API URL and rebuild the frontend.

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

Approval requests are stored in memory, so they are lost when the application restarts. Email and help desk integrations are not included. The escalation rules and approval workflow still need confirmation from Mara.
