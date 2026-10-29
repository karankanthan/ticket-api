# ticket-api

A small service that serves support ticket data and a per-category summary, plus a simple web page.

Requires Python 3.8 or newer.

## Setup

Install the dependencies:

```powershell
python -m pip install -r requirements.txt
```

## Run

From the project root directory, configure the sample CSV path and start the API:

```powershell
$env:TICKETS_DATA_PATH = "data/tickets_sample.csv"
python -m uvicorn app.main:app --reload
```

Then open:

- API documentation: http://localhost:8000/docs
- Web page: http://localhost:8000/
- Ticket summary: http://localhost:8000/summary

The summary includes the total number of tickets and, for each category, its ticket count and average resolution time. Tickets without a valid resolution duration are excluded from that category's average.

## Test

Run the tests from the project root directory:

```powershell
python -m pytest -q
```

The tests cover ticket pagination, ticket lookup, and summary output.


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
