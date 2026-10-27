import csv
import os
from .ticket_summary import summarize_tickets
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles

DATA_PATH = os.environ["TICKETS_DATA_PATH"]
FMT = "%Y-%m-%d %H:%M"
WEB_DIR = Path(__file__).resolve().parent.parent / "web"


def load_tickets(path):
    tickets = []
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            row["created"] = datetime.strptime(row["created_at"], FMT)
            row["resolved"] = (
                datetime.strptime(row["resolved_at"], FMT) if row["resolved_at"] else None
            )
            tickets.append(row)
    return tickets


TICKETS = load_tickets(DATA_PATH)

app = FastAPI(title="ticket-api")


def public(ticket):
    return {k: ticket[k] for k in ("ticket_id", "created_at", "resolved_at", "category", "priority", "status")}


@app.get("/tickets")
def list_tickets(page: int = Query(1, ge=1), size: int = Query(10, ge=1, le=100)):
    start = (page - 1) * size 
    return [public(t) for t in TICKETS[start : start + size]]


@app.get("/tickets/{ticket_id}")
def get_ticket(ticket_id: str):
    for t in TICKETS:
        if t["ticket_id"] == ticket_id:
            return public(t)
    raise HTTPException(status_code=404, detail="ticket not found")


@app.get("/summary")
def summary():
    by_category = summarize_tickets(DATA_PATH)

    return {
        "total": len(TICKETS),
        "by_category": by_category,
    }


app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
