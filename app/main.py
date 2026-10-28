import csv
import os
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

DATA_PATH = os.environ["TICKETS_DATA_PATH"]
FMT = "%Y-%m-%d %H:%M"
WEB_DIR = Path(__file__).resolve().parent.parent / "web"

app = FastAPI(title="ticket-api")
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
    tickets = []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            row["created"] = datetime.strptime(row["created_at"], FMT)
            row["resolved"] = (
                datetime.strptime(row["resolved_at"], FMT)
                if row["resolved_at"]
                else None
            )
            tickets.append(row)
    return tickets


TICKETS = load_tickets(DATA_PATH)


class TriageRequest(BaseModel):
    subject: str = Field(max_length=200)
    text: str = Field(max_length=5000)


class ApprovalRequestCreate(BaseModel):
    ticket_id: str
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
    by_category = summarize_tickets(DATA_PATH)

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


app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")