from . import activity, clock
from .config import settings
from .escalation import escalation_reasons
from .store import PersistentDict

ACTIONS = {
    "approve": "approved",
    "reject": "rejected",
    "need_more_info": "info_requested",
}
OPEN_STATUSES = {"pending", "info_requested"}

REQUESTS = PersistentDict(settings.store_dir / "approvals.json")


def create_request(ticket_id, priority, refund_amount=None, team_account_closing=False, ticket=None, source="api", batch_id=None, employee_email=None, context=None):
    reasons = escalation_reasons(priority, refund_amount, team_account_closing)
    now = clock.timestamp()
    with REQUESTS.lock:
        request_id = REQUESTS.next_id("REQ")
        request = {
            "request_id": request_id,
            "ticket_id": ticket_id,
            "ticket": ticket,
            "refund_amount": refund_amount,
            "team_account_closing": team_account_closing,
            "escalated": bool(reasons),
            "escalation_reasons": reasons,
            "status": "pending",
            "note": None,
            "source": source,
            "batch_id": batch_id,
            "created_at": now,
            "updated_at": now,
            "decided_at": None,
            "emailed_at": None,
            "reminders_sent": 0,
            "last_reminder_at": None,
            # Who to tell about the decision; never shown unmasked by the APIs.
            "employee_email": employee_email or None,
            "employee_notifications": [],
            # What the manager is shown about the ticket, captured when the request is created.
            "context": context,
            "history": [
                {"event": "created", "status": "pending", "via": source, "note": None, "at": now},
            ],
        }
        REQUESTS[request_id] = request
    activity.record(
        "request_created",
        f"Approval request {request_id} created for {ticket_id}",
        request_id=request_id,
        ticket_id=ticket_id,
        via=source,
        batch_id=batch_id,
    )
    return request


def active_request_for(ticket_id):
    """The open (pending or info requested) request for a ticket, if any."""
    for request in REQUESTS.values():
        if request["ticket_id"] == ticket_id and request["status"] in OPEN_STATUSES:
            return request
    return None


def apply_action(request_id, action, note=None, via="api"):
    with REQUESTS.lock:
        request = REQUESTS.get(request_id)
        if request is None:
            raise LookupError("request not found")
        if action not in ACTIONS:
             raise ValueError(f"unknown action, use one of: {', '.join(ACTIONS)}")
        if request["status"] not in OPEN_STATUSES:
            raise ValueError("request is already decided")
        if action == "need_more_info" and not (note and note.strip()):
            raise ValueError("a note is required when asking for more info")

        now = clock.timestamp()
        request["status"] = ACTIONS[action]
        request["note"] = note
        request["updated_at"] = now
        if request["status"] not in OPEN_STATUSES:
            request["decided_at"] = now
        request.setdefault("history", []).append(
            {"event": action, "status": request["status"], "via": via, "note": note, "at": now}
        )
        REQUESTS.save()
    activity.record(
        "decision",
        f"{request_id} ({request['ticket_id']}) marked {request['status'].replace('_', ' ')} via {via}",
        request_id=request_id,
        ticket_id=request["ticket_id"],
        action=action,
        status=request["status"],
        via=via,
    )
    return request


def provide_info(request_id, note):
    """Helpdesk Head answers the manager's request for more information."""
    if not (note and note.strip()):
        raise ValueError("a note is required when providing more info")
    with REQUESTS.lock:
        request = REQUESTS.get(request_id)
        if request is None:
            raise LookupError("request not found")
        if request["status"] != "info_requested":
            raise ValueError("more information was not requested for this request")
        now = clock.timestamp()
        request["updated_at"] = now
        request["history"].append(
            {"event": "info_provided", "status": "info_requested", "via": "helpdesk", "note": note, "at": now}
        )
        REQUESTS.save()
    activity.record(
        "info_provided",
        f"More information added to {request_id} ({request['ticket_id']})",
        request_id=request_id,
        ticket_id=request["ticket_id"],
    )
    return request


def reopen_for_batch(request_id, batch_id):
    """Send an info-requested request back to the manager in a new batch."""
    with REQUESTS.lock:
        request = REQUESTS[request_id]
        if request["status"] != "info_requested":
            raise ValueError(f"{request_id} is {request['status']}, not waiting for more information")
        now = clock.timestamp()
        request.update(
            status="pending", batch_id=batch_id, emailed_at=None,
            reminders_sent=0, last_reminder_at=None, updated_at=now,
        )
        request["history"].append(
            {"event": "resubmitted", "status": "pending", "via": "batch", "note": None, "at": now}
        )
        REQUESTS.save()
    return request


def mark_emailed(request_ids, at, reminder_counts=None):
    with REQUESTS.lock:
        for request_id in request_ids:
            request = REQUESTS[request_id]
            if reminder_counts:
                request["reminders_sent"] = reminder_counts[request_id]
                request["last_reminder_at"] = at
            elif not request.get("emailed_at"):
                request["emailed_at"] = at
        REQUESTS.save()
