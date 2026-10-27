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
