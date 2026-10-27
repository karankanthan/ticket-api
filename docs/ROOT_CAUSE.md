# Root Cause Analysis — Ticket API

## 1. API Startup Failure

**Problem:** The startup command provided in the README failed to start the API.

**Root Cause:** The README used `uvicorn main:app --reload`, but the FastAPI application is located in `app/main.py`. The application also requires the `TICKETS_DATA_PATH` environment variable to locate the CSV file.

**How the Issue Was Identified:** Running the documented command produced the error `Could not import module "main"`.

**Fix Applied:** Set the data path and started the application using:

```powershell
$env:TICKETS_DATA_PATH = "data/tickets_sample.csv"
python -m uvicorn app.main:app --reload
```

## 2. Pagination Skipped the First Ticket

**Problem:** The first page of tickets returned `TCK-1002` instead of `TCK-1001`.

**Root Cause:** The pagination start index included an unnecessary `+ 1`, causing the first ticket to be skipped.

**How the Issue Was Identified:** Added an assertion to verify that the first ticket on page one was `TCK-1001`. The test failed before the fix.

**Fix Applied:** Changed the pagination calculation from:

```python
start = (page - 1) * size + 1
```

to:

```python
start = (page - 1) * size
```

**Verification:** The pagination test passed after the change.

## 3. Incorrect Average Resolution Time

**Problem:** The API initially returned an overall average resolution time of 17.69 hours, which did not correctly represent the average duration of resolved tickets.

**Root Cause:** The total resolution duration was divided by the total number of tickets, including unresolved tickets.

**How the Issue Was Identified:** Added a test expecting an average of 25.27 hours based on the resolved tickets. The test failed before the fix.

**Fix Applied:** Divided the total resolution duration by the number of resolved tickets.

## 4. Summary Endpoint Did Not Match the Required Output

**Problem:** The original `/summary` endpoint returned one overall average instead of calculating the average resolution time for each category.

**Root Cause:** The original implementation calculated a single average across all resolved tickets rather than grouping resolution durations by category.

**How the Issue Was Identified:** Confirmed the required behavior with the mentor and compared the existing API output with the Day 1 summary module.

**Fix Applied:** Integrated the Day 1 `summarize_tickets()` logic into the API. The endpoint now returns the total ticket count and, for each category, its ticket count and average resolution time. Categories without resolved tickets return `null` for the average.

## Verification Results

- All three API tests passed after the changes.
- The pagination test verifies that the first ticket is no longer skipped.
- The summary endpoint was opened and verified in the browser.
- The API returned 60 tickets across six categories, with a separate average resolution time for each category.
- One non-blocking Starlette deprecation warning remains regarding the current `httpx` test-client integration.

