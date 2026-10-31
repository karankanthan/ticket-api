"""AI Triage only suggests: calling POST /triage must never create or change TicketFlow data."""

import copy
from unittest.mock import patch

import pytest

from app import activity, approvals, batches, main, recommendations, tokens

STORES = {
    "approval requests": approvals.REQUESTS,
    "approval queue": recommendations.QUEUE,
    "batches": batches.BATCHES,
    "action tokens": tokens.TOKENS,
    "activity": activity.EVENTS,
}

SUGGESTION = {
    "category": "Refunds",
    "priority": "high",
    "suggested_reply": "A support agent will review your refund request.",
    "source_article_ids": ["KB-002"],
}


def snapshot():
    state = {name: copy.deepcopy(dict(store)) for name, store in STORES.items()}
    state["tickets"] = copy.deepcopy(main.TICKETS)
    state["files"] = {name: store.path.read_bytes() if store.path.exists() else None for name, store in STORES.items()}
    return state


@pytest.fixture
def busy_workflow(workflow):
    """Realistic state to protect: queued tickets, a pending batch and one decision."""
    workflow.submit("T-8", "T-1")
    links = workflow.links(workflow.emails()[-1])
    workflow.client.post(links["T-8"]["approve"], data={"confirm": "yes", "note": "ok"})
    return workflow


def call_triage(workflow, **body):
    return workflow.client.post("/triage", json={"subject": "Refund for order 8841", "text": "I was charged twice, please refund.", **body})


def test_successful_triage_changes_nothing(busy_workflow):
    before = snapshot()
    emails_before = len(busy_workflow.emails())
    # Real knowledge-base retrieval; only the external AI call is replaced.
    with patch("app.main.generate_triage", return_value=SUGGESTION):
        for _ in range(3):
            response = call_triage(busy_workflow)
            assert response.status_code == 200
            assert response.json() == SUGGESTION
    assert snapshot() == before
    assert len(busy_workflow.emails()) == emails_before
    assert busy_workflow.client.get("/api/tickets").json()["total"] == len(before["tickets"])


def test_failed_triage_changes_nothing(busy_workflow):
    before = snapshot()
    with patch("app.main.generate_triage", side_effect=RuntimeError("AI unavailable")):
        assert call_triage(busy_workflow).status_code == 502
    assert call_triage(busy_workflow, subject=" ", text=" ").status_code == 422
    assert snapshot() == before


def test_triage_suggestion_is_not_added_to_the_queue_or_tickets(busy_workflow):
    with patch("app.main.generate_triage", return_value={**SUGGESTION, "priority": "urgent"}):
        call_triage(busy_workflow, subject="URGENT: brand-new ticket TRIAGE-1")
    ids = {t["ticket_id"] for t in busy_workflow.client.get("/api/tickets").json()["tickets"]}
    assert not any("TRIAGE" in i for i in ids)
    assert not any("TRIAGE" in i["ticket_id"] for i in recommendations.QUEUE.values())
