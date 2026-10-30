from . import clock
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


def create_request(ticket_id, priority, refund_amount=None, team_account_closing=False, ticket=None, source="api"):
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
            "created_at": now,
            "updated_at": now,
            "decided_at": None,
            "history": [
                {"event": "created", "status": "pending", "via": source, "note": None, "at": now},
            ],
        }
        REQUESTS[request_id] = request
    return request


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
    return request
