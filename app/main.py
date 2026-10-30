import asyncio
import csv
import logging
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .ticket_summary import summarize_tickets
from .retrieval import retrieve_articles
from .ai_service import generate_triage
from .approvals import REQUESTS, apply_action, create_request
from .config import PROJECT_DIR, settings
from . import activity, automation, email_service, recommendations
from .admin_api import create_router
from .manager_actions import router as manager_router

FMT = "%Y-%m-%d %H:%M"
WEB_DIR = PROJECT_DIR / "web"
DATA_PATH = settings.tickets_data_path

log = logging.getLogger("ticket_api")


@asynccontextmanager
async def lifespan(app):
    recommendations.analyse_tickets(TICKETS)
    task = None
    if settings.scheduler_enabled:
        task = asyncio.create_task(automation.scheduler_loop(lambda: TICKETS))
    yield
    if task:
        task.cancel()


app = FastAPI(title="ticket-api", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def load_tickets(path):
    if not Path(path).is_file():
        raise RuntimeError(
            f"Ticket data file not found: {path}. "
            "Set TICKETS_DATA_PATH to the CSV file, for example data/tickets_sample.csv."
        )

    tickets = []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            row.setdefault("resolved_at", "")
            row["created"] = datetime.strptime(row["created_at"], FMT)
            row["resolved"] = (
                datetime.strptime(row["resolved_at"], FMT)
                if row["resolved_at"]
                else None
            )
            tickets.append(row)
    return tickets


TICKETS = load_tickets(DATA_PATH)


def reload_tickets():
    """Re-read the ticket CSV. On any error the current tickets stay in place."""
    new_tickets = load_tickets(DATA_PATH)
    TICKETS[:] = new_tickets
    activity.record("tickets_imported", f"Imported {len(new_tickets)} tickets from the CSV file", count=len(new_tickets))
    return len(new_tickets)


class TriageRequest(BaseModel):
    subject: str = Field(max_length=200)
    text: str = Field(max_length=5000)


class ApprovalRequestCreate(BaseModel):
    ticket_id: str = Field(min_length=1, max_length=50)
    refund_amount: Optional[float] = Field(None, ge=0)
    team_account_closing: bool = False


class ApprovalAction(BaseModel):
    action: str
    note: Optional[str] = Field(None, max_length=1000)


def public(ticket):
    return {
        k: ticket[k]
        for k in (
            "ticket_id",
            "created_at",
            "resolved_at",
            "category",
            "priority",
            "status",
        )
    }


def find_ticket(ticket_id):
    for ticket in TICKETS:
        if ticket["ticket_id"] == ticket_id:
            return ticket
    return None

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/tickets")
def list_tickets(
    page: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=100),
):
    start = (page - 1) * size
    return [public(ticket) for ticket in TICKETS[start:start + size]]


@app.get("/tickets/{ticket_id}")
def get_ticket(ticket_id: str):
    for ticket in TICKETS:
        if ticket["ticket_id"] == ticket_id:
            return public(ticket)

    raise HTTPException(status_code=404, detail="ticket not found")


@app.get("/summary")
def summary():
    try:
        by_category = summarize_tickets(DATA_PATH)
    except ValueError as error:
        raise HTTPException(
            status_code=503,
            detail=f"Summary is not available for this data file. {error}",
        )

    return {
        "total": len(TICKETS),
        "by_category": by_category,
    }


@app.post("/triage")
def triage(request: TriageRequest):
    subject = request.subject.strip()
    text = request.text.strip()

    if not subject and not text:
        raise HTTPException(
            status_code=422,
            detail="Enter a ticket subject or message.",
        )

    try:
        articles = retrieve_articles(subject, text)


        result = generate_triage(subject, text, articles)
        return result

    except Exception:
        raise HTTPException(
            status_code=502,
            detail=(
                "Ticket triage is temporarily unavailable. "
                "Please try again."
            ),
        )


@app.post("/approval-requests", status_code=201)
def create_approval_request(body: ApprovalRequestCreate):
    ticket = find_ticket(body.ticket_id)
    if ticket is None:
        raise HTTPException(status_code=404, detail="ticket not found")

    return create_request(
        body.ticket_id,
        ticket["priority"],
        body.refund_amount,
        body.team_account_closing,
        ticket=public(ticket),
    )


@app.get("/approval-requests")
def list_approval_requests():
    return list(REQUESTS.values())


@app.get("/approval-requests/{request_id}")
def get_approval_request(request_id: str):
    if request_id not in REQUESTS:
        raise HTTPException(status_code=404, detail="request not found")
    return REQUESTS[request_id]


@app.post("/approval-requests/{request_id}/actions")
def act_on_approval_request(request_id: str, body: ApprovalAction):
    try:
        return apply_action(request_id, body.action, body.note)
    except LookupError:
        raise HTTPException(status_code=404, detail="request not found")
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


@app.get("/api/health")
def detailed_health():
    email = email_service.status()
    return {
        "status": "ok",
        "tickets_loaded": len(TICKETS),
        "store_dir_writable": _store_writable(),
        "email_backend": email["backend"],
        "email_ready": email["ready"],
        "scheduler_enabled": settings.scheduler_enabled,
        "scheduler_last_run_at": automation.STATE["last_run_at"],
    }


def _store_writable():
    try:
        settings.store_dir.mkdir(parents=True, exist_ok=True)
        probe = settings.store_dir / ".write-check"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        return True
    except OSError:
        return False


# New routes must be registered before the static mount, which catches every other path.
app.include_router(manager_router)
app.include_router(create_router(lambda: TICKETS, reload_tickets))

app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")